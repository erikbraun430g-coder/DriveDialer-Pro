
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

const encode = (bytes: Uint8Array) => {
  let b = '';
  for (let i = 0; i < bytes.byteLength; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
};

const decode = (base64: string) => {
  const s = atob(base64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
};

const VoiceController: React.FC<VoiceControllerProps> = ({ contacts, currentIndex, setCurrentIndex, onCallComplete }) => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [awaitingClick, setAwaitingClick] = useState(false);
  const [callInitiated, setCallInitiated] = useState(false);
  
  const currentContact = contacts[currentIndex];

  const sessionRef = useRef<any>(null);
  const audioInRef = useRef<AudioContext | null>(null);
  const audioOutRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const cleanup = useCallback(async () => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioInRef.current) {
      await audioInRef.current.close().catch(() => {});
      audioInRef.current = null;
    }
    if (audioOutRef.current) {
      await audioOutRef.current.close().catch(() => {});
      audioOutRef.current = null;
    }
    nextStartTimeRef.current = 0;
    setIsActive(false);
    setIsConnecting(false);
    setAwaitingClick(false);
    setCallInitiated(false);
  }, []);

  // Cleanup enkel bij unmount van de hele app, niet bij index change
  useEffect(() => {
    return () => { cleanup(); };
  }, []);

  const toggleSession = async () => {
    if (isActive || isConnecting) {
      await cleanup();
      return;
    }

    setIsConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inCtx = new AudioContext({ sampleRate: 16000 });
      const outCtx = new AudioContext({ sampleRate: 24000 });
      audioInRef.current = inCtx;
      audioOutRef.current = outCtx;

      const fullData = contacts.map((c, i) => `Taak ${i+1}: ${c.name} (${c.relation}) over: ${c.subject}`).join('\n');

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setIsConnecting(false);
            const source = inCtx.createMediaStreamSource(stream);
            const processor = inCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (!sessionRef.current) return;
              const input = e.inputBuffer.getChannelData(0);
              const pcm = new Int16Array(input.length);
              for (let i = 0; i < input.length; i++) pcm[i] = input[i] * 32768;
              sessionRef.current.sendRealtimeInput({
                media: { data: encode(new Uint8Array(pcm.buffer)), mimeType: 'audio/pcm;rate=16000' }
              });
            };
            source.connect(processor);
            processor.connect(inCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && audioOutRef.current) {
              const raw = decode(audioData);
              const int16 = new Int16Array(raw.buffer);
              const buffer = audioOutRef.current.createBuffer(1, int16.length, 24000);
              const channel = buffer.getChannelData(0);
              for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768.0;
              const source = audioOutRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(audioOutRef.current.destination);
              const startTime = Math.max(nextStartTimeRef.current, audioOutRef.current.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'goto_item') {
                  const idx = (fc.args.index as number) - 1;
                  if (idx >= 0 && idx < contacts.length) {
                    setCurrentIndex(idx);
                    setAwaitingClick(false);
                  }
                }
                if (fc.name === 'prepare_dial') {
                  setAwaitingClick(true);
                }
                sessionRef.current?.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                });
              }
            }
          },
          onerror: () => cleanup(),
          onclose: () => cleanup()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          tools: [{ functionDeclarations: [
            { name: 'goto_item', parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } }, required: ['index'] } },
            { name: 'prepare_dial', parameters: { type: Type.OBJECT, properties: {} } }
          ]}] as any,
          systemInstruction: `Je bent de stem van DriveDialer.
          
          LIJST DATA:
          ${fullData}

          INSTRUCTIES:
          1. Als de gebruiker vraagt om een taak (bijv. "nu taak 12"), gebruik 'goto_item' met de juiste index.
          2. Zeg ALTIJD eerst: "[Naam], [Organisatie], [Onderwerp]". 
          3. Wees kort van stof. Geen meta-taal.
          4. Als de gebruiker wil bellen, gebruik 'prepare_dial'.
          5. Belangrijk: De index in de lijst begint bij 1. De UI toont ook Taak X / Totaal.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error(e);
      await cleanup();
    }
  };

  const cleanPhone = currentContact?.phone.replace(/[^0-9+]/g, '') || '';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      <div className="mb-10 text-center w-full">
        <span className="text-blue-500 font-black text-[10px] tracking-[0.5em] uppercase block mb-4">
          TAAK {currentIndex + 1} / {contacts.length}
        </span>
        <h2 className="text-5xl font-black text-white tracking-tighter uppercase mb-2">
          {currentContact?.name}
        </h2>
        <p className="text-blue-400 font-bold uppercase tracking-widest text-sm mb-6">
          {currentContact?.relation}
        </p>
        <div className="bg-white/5 p-6 rounded-[32px] border border-white/10 mx-auto max-w-sm">
          <p className="text-white/60 text-xs font-bold uppercase tracking-widest leading-relaxed">
            "{currentContact?.subject}"
          </p>
        </div>
      </div>

      <div className="w-full max-w-xs space-y-6">
        {awaitingClick ? (
          <>
            <a 
              href={`tel:${cleanPhone}`}
              onClick={() => setCallInitiated(true)}
              className="w-full aspect-square sm:aspect-video rounded-[50px] bg-green-500 text-black font-black flex flex-col items-center justify-center no-underline shadow-[0_0_60px_rgba(34,197,94,0.4)] animate-in zoom-in-95"
            >
              <span className="text-sm opacity-50 mb-1">BEL NU</span>
              <span className="text-3xl tracking-tighter">{currentContact?.phone}</span>
            </a>
            {callInitiated && (
              <button 
                onClick={() => onCallComplete(currentContact.id)}
                className="w-full py-6 rounded-[30px] bg-blue-600 font-black uppercase tracking-widest text-sm"
              >
                Volgende Taak
              </button>
            )}
          </>
        ) : (
          <button 
            onClick={toggleSession}
            className={`w-full aspect-square sm:aspect-video rounded-[50px] font-black text-4xl shadow-2xl transition-all ${
              isActive ? 'bg-red-600' : 'bg-blue-600'
            }`}
          >
            {isConnecting ? '...' : isActive ? 'STOP' : 'START'}
          </button>
        )}
      </div>

      <div className="mt-10 h-10 flex items-center gap-1.5">
        {isActive && !awaitingClick && [1,2,3,4,5].map(i => (
          <div key={i} className="w-1.5 bg-blue-500 rounded-full animate-bounce h-full" style={{animationDelay: `${i*0.1}s`}}></div>
        ))}
      </div>
    </div>
  );
};

export default VoiceController;
