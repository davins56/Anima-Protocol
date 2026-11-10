import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/vessel/vesselModelUpload", async (orig) => ({ ...(await orig<object>()), uploadVesselModel: upload }));

import VesselModelUpload from "./VesselModelUpload";

function glbFile(name = "a.vrm") {
  const b = new Uint8Array(32);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, 32, true);
  return new File([b], name);
}

describe("<VesselModelUpload>", () => {
  beforeEach(() => {
    upload.mockReset();
  });

  it("rejects a wrong file type before any network call", async () => {
    render(<VesselModelUpload characterId="c" model={{ kind: "procedural" }} onUploaded={vi.fn()} onUseProcedural={vi.fn()} />);
    fireEvent.change(screen.getByTestId("vessel-model-input"), { target: { files: [new File(["x"], "a.fbx")] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/vrm or \.glb/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a dropped VRM, shows progress, then hands back the new vessel", async () => {
    const onUploaded = vi.fn();
    upload.mockImplementation(async (_id, _f, opts) => {
      opts.onPhase("uploading");
      opts.onProgress(0.42);
      await new Promise((r) => setTimeout(r, 10));
      opts.onPhase("done");
      return { vessel: { version: 3, config: {} } };
    });
    render(<VesselModelUpload characterId="c" model={{ kind: "procedural" }} onUploaded={onUploaded} onUseProcedural={vi.fn()} />);
    fireEvent.drop(screen.getByRole("button", { name: /upload a vrm/i }), { dataTransfer: { files: [glbFile()] } });
    expect(await screen.findByText(/Uploading 42%/)).toBeTruthy();
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ version: 3, config: {} }));
    expect(upload.mock.calls[0][0]).toBe("c");
  });

  it("shows the server error and offers replace / procedural for an existing model", async () => {
    upload.mockRejectedValue(Object.assign(new Error("x"), { code: "model_too_large" }));
    const onUseProcedural = vi.fn();
    render(
      <VesselModelUpload
        characterId="c"
        model={{ kind: "vrm", url: "/api/vessel/c/model", byteSize: 2 * 1048576, expressions: ["happy", "aa"], visemes: ["aa"] }}
        onUploaded={vi.fn()}
        onUseProcedural={onUseProcedural}
      />,
    );
    expect((screen.getByTestId("vessel-model-current")).textContent).toMatch(/uploaded VRM 2.0 MB/);
    expect(screen.getByText(/Replace model/)).toBeTruthy();
    fireEvent.change(screen.getByTestId("vessel-model-input"), { target: { files: [glbFile()] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/larger than 50 MB/);
    fireEvent.click(screen.getByText(/Use procedural vessel/));
    expect(onUseProcedural).toHaveBeenCalled();
  });
});
