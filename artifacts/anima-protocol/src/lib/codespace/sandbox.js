// In-browser execution sandbox for the Codespace.
//
// Everything here runs fully isolated from the parent Anima app:
//   - Web projects render in an <iframe sandbox="allow-scripts"> built from a
//     srcdoc. Because allow-same-origin is NOT granted, the iframe gets a unique
//     opaque origin and cannot read the parent app's cookies, storage, Clerk
//     session, or DOM. Cross-origin postMessage is still allowed, which is how
//     console output is streamed back.
//   - Scripts (JS / Python) run in a Web Worker spun up from a Blob URL. Workers
//     have no DOM and no reference to the parent window, so they cannot touch the
//     app's data or session either. Each run is hard-killed after a timeout.

const PREVIEW_TOKEN = "anima-codespace-preview";

function findFile(files, name) {
  return files.find((f) => f.path === name || f.path.endsWith("/" + name));
}

// Console-capture + error-trapping preamble injected into every web preview.
// It forwards console output and uncaught errors to the parent via postMessage
// (tagged with a token so the host can filter), without exposing anything from
// the parent back into the frame.
function consolePreamble() {
  return `<script>
(function(){
  var TOKEN=${JSON.stringify(PREVIEW_TOKEN)};
  function send(level,args){
    try{
      var text=Array.prototype.map.call(args,function(a){
        try{return typeof a==='object'?JSON.stringify(a):String(a);}catch(e){return String(a);}
      }).join(' ');
      parent.postMessage({__token:TOKEN,level:level,text:text},'*');
    }catch(e){}
  }
  ['log','info','warn','error','debug'].forEach(function(m){
    var orig=console[m];
    console[m]=function(){send(m==='debug'?'log':m,arguments);try{orig.apply(console,arguments);}catch(e){}};
  });
  window.addEventListener('error',function(e){send('error',[e.message+' ('+(e.filename||'')+':'+(e.lineno||0)+')']);});
  window.addEventListener('unhandledrejection',function(e){send('error',['Unhandled rejection: '+(e.reason&&e.reason.message||e.reason)]);});
})();
<\/script>`;
}

// Assemble a single self-contained HTML document from the virtual file set so
// the iframe can render it with no network/file-system access. Local <link> and
// <script src> references to files that exist in the project are inlined.
export function buildPreviewSrcdoc(files) {
  const indexFile = findFile(files, "index.html");
  let html = indexFile ? indexFile.content : "";

  if (!indexFile) {
    // No HTML entry: if there's a script.js, run it inside a bare page so the
    // preview still does something useful.
    const js = findFile(files, "script.js");
    html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${
      js ? `<script>${js.content}<\/script>` : "<pre>No index.html in this project yet.</pre>"
    }</body></html>`;
  }

  // Inline local stylesheets: <link rel="stylesheet" href="styles.css">
  html = html.replace(
    /<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,
    (tag, href) => {
      if (/^https?:|^\/\//i.test(href)) return tag; // leave remote links alone
      const f = findFile(files, href.replace(/^\.?\//, ""));
      return f ? `<style>\n${f.content}\n</style>` : tag;
    },
  );

  // Inline local scripts: <script src="script.js"></script>
  html = html.replace(
    /<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (tag, src) => {
      if (/^https?:|^\/\//i.test(src)) return tag;
      const f = findFile(files, src.replace(/^\.?\//, ""));
      return f ? `<script>\n${f.content}\n<\/script>` : tag;
    },
  );

  // Inject the console bridge as early as possible.
  const preamble = consolePreamble();
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + preamble);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => m + preamble);
  } else {
    html = preamble + html;
  }

  return html;
}

export function isPreviewMessage(event) {
  return Boolean(event && event.data && event.data.__token === PREVIEW_TOKEN);
}

// Worker source for running a JS file in isolation. Console + errors are posted
// back; a "done" message signals normal completion.
function jsWorkerSource(code) {
  return `
self.window=undefined;
function send(level,text){self.postMessage({type:'log',level:level,text:text});}
['log','info','warn','error','debug'].forEach(function(m){
  console[m]=function(){
    var text=Array.prototype.map.call(arguments,function(a){
      try{return typeof a==='object'?JSON.stringify(a):String(a);}catch(e){return String(a);}
    }).join(' ');
    send(m==='debug'?'log':m,text);
  };
});
self.onerror=function(msg){send('error',String(msg));self.postMessage({type:'done',ok:false});};
(async function(){
  try{
    ${code}
    self.postMessage({type:'done',ok:true});
  }catch(e){
    send('error',(e&&e.stack)||String(e));
    self.postMessage({type:'done',ok:false});
  }
})();
`;
}

// Worker source for running Python via Pyodide (loaded from the public CDN at
// runtime — no bundled dependency). stdout/stderr are routed to the host.
function pythonWorkerSource(code) {
  return `
var PYODIDE="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";
function send(level,text){self.postMessage({type:'log',level:level,text:text});}
self.onerror=function(msg){send('error',String(msg));self.postMessage({type:'done',ok:false});};
(async function(){
  try{
    send('log','Booting Python runtime (first run downloads the interpreter)...');
    importScripts(PYODIDE+'pyodide.js');
    var pyodide=await loadPyodide({indexURL:PYODIDE});
    pyodide.setStdout({batched:function(s){send('log',s);}});
    pyodide.setStderr({batched:function(s){send('error',s);}});
    await pyodide.runPythonAsync(${JSON.stringify(code)});
    self.postMessage({type:'done',ok:true});
  }catch(e){
    send('error',(e&&e.message)||String(e));
    self.postMessage({type:'done',ok:false});
  }
})();
`;
}

// Run a script file in a worker. Streams logs via onLog and resolves with the
// collected output once the worker signals completion or the timeout fires.
export function runScript({ language, code, onLog, timeoutMs = 10000 }) {
  return new Promise((resolve) => {
    const source =
      language === "python" ? pythonWorkerSource(code) : jsWorkerSource(code);
    const blob = new Blob([source], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    let worker;
    const logs = [];
    let settled = false;

    // Python needs longer for the first-run interpreter download.
    const effectiveTimeout =
      language === "python" ? Math.max(timeoutMs, 45000) : timeoutMs;

    const finish = (timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker && worker.terminate(); } catch { /* noop */ }
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
      if (timedOut) {
        const t = { level: "error", text: `Execution timed out after ${Math.round(effectiveTimeout / 1000)}s and was stopped.` };
        logs.push(t);
        onLog && onLog(t);
      }
      resolve({ logs, timedOut: Boolean(timedOut) });
    };

    const timer = setTimeout(() => finish(true), effectiveTimeout);

    try {
      worker = new Worker(url);
      worker.onmessage = (e) => {
        const d = e.data || {};
        if (d.type === "log") {
          const entry = { level: d.level || "log", text: d.text };
          logs.push(entry);
          onLog && onLog(entry);
        } else if (d.type === "done") {
          finish(false);
        }
      };
      worker.onerror = (err) => {
        const entry = { level: "error", text: err.message || "Worker error" };
        logs.push(entry);
        onLog && onLog(entry);
        finish(false);
      };
    } catch (err) {
      const entry = { level: "error", text: String(err) };
      logs.push(entry);
      onLog && onLog(entry);
      finish(false);
    }
  });
}
