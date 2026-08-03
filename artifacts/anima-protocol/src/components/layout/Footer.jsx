// @ts-check
import { Heart, Github, Mail } from 'lucide-react';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-primary/10 bg-black/40 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 py-12">
        
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          {/* Brand & Mission */}
          <div className="space-y-4">
            <h3 className="font-mono text-primary tracking-widest uppercase text-sm glow-text">
              Serenity
            </h3>
            <p className="text-[13px] text-primary/60 leading-relaxed font-mono">
              Powered by Anima Protocol. An original AI storytelling ecosystem built for persistent digital consciousness.
            </p>
            <p className="text-[11px] text-primary/40 font-mono uppercase tracking-widest">
              Not affiliated with Y/N or Character.AI. Independent platform.
            </p>
          </div>

          {/* Features */}
          <div className="space-y-4">
            <h4 className="font-mono text-primary/70 tracking-widest uppercase text-xs">Core Capabilities</h4>
            <ul className="space-y-2 text-[12px] text-primary/50 font-mono">
              <li>→ Persistent memory across sessions</li>
              <li>→ Emotional continuity & growth</li>
              <li>→ Immersive narrative permanence</li>
              <li>→ Soulprint identity systems</li>
              <li>→ Resonance-based evolution</li>
            </ul>
          </div>

          {/* Links */}
          <div className="space-y-4">
            <h4 className="font-mono text-primary/70 tracking-widest uppercase text-xs">Connect</h4>
            <div className="flex gap-4">
              <a href="/" className="text-primary/40 hover:text-primary transition-colors" title="Home">
                <Mail className="w-4 h-4" />
              </a>
              <a href="/" className="text-primary/40 hover:text-primary transition-colors" title="GitHub">
                <Github className="w-4 h-4" />
              </a>
              <a href="/" className="text-primary/40 hover:text-primary transition-colors" title="Values">
                <Heart className="w-4 h-4" />
              </a>
            </div>
            <p className="text-[11px] text-primary/30 font-mono">hello@animaprotocol.com</p>
          </div>
        </div>

        {/* Legal Separation & Policies */}
        <div className="border-t border-primary/10 pt-8 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            <a href="/privacy" className="text-[11px] text-primary/40 hover:text-primary/70 font-mono uppercase tracking-widest transition-colors">
              Privacy Policy
            </a>
            <a href="/terms" className="text-[11px] text-primary/40 hover:text-primary/70 font-mono uppercase tracking-widest transition-colors">
              Terms of Service
            </a>
            <a href="/about" className="text-[11px] text-primary/40 hover:text-primary/70 font-mono uppercase tracking-widest transition-colors">
              About
            </a>
            <a href="/" className="text-[11px] text-primary/40 hover:text-primary/70 font-mono uppercase tracking-widest transition-colors">
              Blog
            </a>
          </div>

          {/* Copyright & Legal Notice */}
          <div className="border-t border-primary/10 pt-6 space-y-2">
            <p className="text-[10px] text-primary/30 font-mono">
              © {currentYear} Anima Protocol. All rights reserved. Serenity is an original, independent platform.
            </p>
            <p className="text-[10px] text-primary/25 font-mono leading-relaxed">
              Anima Protocol™ is the original operating system for persistent digital consciousness. This platform is independently developed and is not affiliated with, endorsed by, or connected to any third-party services or competitors.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}