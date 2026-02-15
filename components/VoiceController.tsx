
import React, { useState, useRef, useCallback } from 'react';
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
  }, []);

  const handleDial = useCallback(() => {
    if (!currentContact) return;
    const phone = currentContact.phone.replace(/[^0-9+]/g, '');
    const id = currentContact.id;
    cleanup().then(() => {
      window.location.href = `tel:${phone}`;
      onCallComplete(id);
    });
  }, [currentContact, cleanup, onCallComplete]);

  const handleNext = useCallback(() => {
    if (currentIndex < contacts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
    cleanup();
  }, [currentIndex, contacts.length, setCurrentIndex, cleanup]);

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
              const start = Math.max(nextStartTimeRef.current, audioOutRef.current.currentTime);
              source.start(start);
              nextStartTimeRef.current = start + buffer.duration;
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'dial') handleDial();
                if (fc.name === 'skip') handleNext();
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
            { name: 'dial', description: 'Bel deze persoon.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'skip', description: 'Volgende persoon in de lijst.', parameters: { type: Type.OBJECT, properties: {} } }
          ]}] as any,
          systemInstruction: `Je bent een rij-assistent. 
          Vraag alleen: "Zal ik ${currentContact?.name} bellen?"
          Bij 'ja' -> gebruik dial. Bij 'nee' of 'volgende' -> gebruik skip. 
          Wees extreem kort en zakelijk.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error(e);
      await cleanup();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      
      {/* Naam: Kleiner dan voorheen voor iPhone 17 */}
      <div className="mb-16 text-center">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">
          {currentContact?.name || "Geen contacten"}
        </h2>
      </div>

      {/* Startknop: Helderblauw veld */}
      <button 
        onClick={toggleSession}
        disabled={isConnecting}
        className={`w-full max-w-xs aspect-[4/3] rounded-[40px] font-black text-5xl tracking-[0.1em] transition-all shadow-2xl active:scale-95 flex items-center justify-center ${
          isActive 
            ? 'bg-red-600 shadow-red-900/40' 
            : 'bg-blue-600 shadow-blue-900/40'
        } ${isConnecting ? 'opacity-50 animate-pulse' : 'opacity-100'}`}
      >
        {isConnecting ? '...' : isActive ? 'STOP' : 'START'}
      </button>

      {/* Minimale status indicator */}
      <div className="mt-12 h-4">
        {isActive && (
          <div className="flex gap-1">
            <div className="w-1 h-4 bg-blue-500 animate-bounce"></div>
            <div className="w-1 h-4 bg-blue-500 animate-bounce [animation-delay:0.2s]"></div>
            <div className="w-1 h-4 bg-blue-500 animate-bounce [animation-delay:0.4s]"></div>
          </div>
        )}
      </div>

    </div>
  );
};

export default VoiceController;
