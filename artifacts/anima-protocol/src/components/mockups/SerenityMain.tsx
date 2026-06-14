import React from 'react';
import ChatLayoutWrapper from '../chat/ChatLayoutWrapper';   // ← Fixed: no extra dots/spaces

export default function SerenityMain(): React.ReactElement {
  return (
    <ChatLayoutWrapper>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-8xl mb-8">🌌</div>
          <div className="text-6xl font-mono tracking-[0.5em] text-cyan-300 mb-4">SERENITY.AI</div>
          <p className="text-cyan-400/80 text-xl">Connection established. Ready to assist.</p>

          <div className="mt-12 space-x-4">
            <button className="px-8 py-4 border border-cyan-400 rounded-xl text-cyan-300 hover:bg-cyan-500/10">
              + INITIALIZE SESSION
            </button>
          </div>
        </div>
      </div>
    </ChatLayoutWrapper>
  );
}