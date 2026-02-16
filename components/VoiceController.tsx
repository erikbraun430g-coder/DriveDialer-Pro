
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
  const [isDialing, setIsDialing] = useState(false);
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
    setIsDialing(false);
  }, []);

  const handleDial = useCallback((index?: number) => {
    const targetIdx = (typeof index === 'number' && index > 0) ? index - 1 : currentIndex;
    const contact = contacts[targetIdx];
    
    if (!contact) return;
    
    setIsDialing(true);
    const phone = contact.phone.replace(/[^0-9+]/g, '');
    const id = contact.id;
    
    // Gebruik een onzichtbare link voor betere browser-compatibiliteit
    const link = document.createElement('a');
    link.href = `tel:${phone}`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    
    // Geef de gebruiker en browser tijd om de overgang te maken
    setTimeout(() => {
      document.body.removeChild(link);
      onCallComplete(id);
      cleanup();
    }, 2000);
  }, [currentIndex, contacts, cleanup, onCallComplete]);

  const handleGoto = useCallback((index: number) => {
    const targetIdx = index - 1;
    if (targetIdx >= 0 && targetIdx < contacts.length) {
      setCurrentIndex(targetIdx);
    }
  }, [contacts.length, setCurrentIndex]);

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

      // Uitgebreide context voor de AI
      const detailedList = contacts.map((c, i) => 
        `Item ${i + 1}: Naam: ${c.name}, Organisatie/Relatie: ${c.relation}, Onderwerp: ${c.subject}, Telefoon: ${c.phone}`
      ).join('\n');

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
                if (fc.name === 'dial') handleDial(fc.args?.index as number);
                if (fc.name === 'goto') handleGoto(fc.args?.index as number);
                if (fc.name === 'skip') handleGoto(currentIndex + 2);
                
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
            { 
              name: 'dial', 
              description: 'Start de telefoon-app om te bellen.', 
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER, description: 'Index van contact' } } } 
            },
            { 
              name: 'goto', 
              description: 'Focus op een specifiek contact op het scherm.', 
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } }, required: ['index'] } 
            },
            { 
              name: 'skip', 
              description: 'Ga naar het volgende contact.', 
              parameters: { type: Type.OBJECT, properties: {} } 
            }
          ]}] as any,
          systemInstruction: `Je bent een proactieve rij-assistent. Je hebt de volledige spreadsheet in je geheugen:

          DATA:
          ${detailedList}

          HUIDIGE FOCUS: Item #${currentIndex + 1} (${currentContact?.name}).

          INSTRUCTIES VOOR INTERACTIE:
          1. Als de gebruiker vraagt: "Bij welk bedrijf werkt hij?", "Wat is het onderwerp?", of "Wie is nummer 5?", zoek dan de informatie op in de DATA hierboven en vertel het uitgebreid. Gebruik 'goto' als ze naar een ander nummer vragen.
          2. Voordat je de 'dial' tool gebruikt, zeg je ALTIJD eerst: "Ik ga [Naam] nu voor je bellen."
          3. Je MOET alle vragen over de spreadsheet beantwoorden. De gebruiker kan alles vragen over relaties en onderwerpen.
          4. Als de gebruiker "bellen", "graag bellen" of "ja" zegt, gebruik dan de 'dial' tool.
          5. Wees kort maar informatief. Spreek uitsluitend Nederlands.`
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
      
      <div className="mb-20 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="inline-block px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">
          <span className="text-blue-500 font-black text-[10px] tracking-[0.3em] uppercase">
             {isDialing ? 'Verbinding maken...' : `Contact ${currentIndex + 1} van ${contacts.length}`}
          </span>
        </div>
        <h2 className={`text-4xl font-black text-white tracking-tighter uppercase mb-2 transition-all ${isDialing ? 'scale-110 text-blue-500' : ''}`}>
          {currentContact?.name || "Klaar"}
        </h2>
        <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.2em]">
          {isDialing ? 'Telefoon wordt geopend' : currentContact?.relation}
        </p>
      </div>

      <button 
        onClick={toggleSession}
        disabled={isConnecting || isDialing}
        className={`relative w-full max-w-xs aspect-video rounded-[50px] font-black text-5xl tracking-[0.1em] transition-all flex items-center justify-center overflow-hidden shadow-2xl active:scale-95 ${
          isActive 
            ? 'bg-red-600 shadow-red-900/40' 
            : 'bg-blue-600 shadow-blue-900/40'
        } ${(isConnecting || isDialing) ? 'opacity-50' : 'opacity-100'}`}
      >
        {isActive && (
          <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
        )}
        <span className="relative z-10">
          {isConnecting ? '...' : isDialing ? 'BEL' : isActive ? 'STOP' : 'START'}
        </span>
      </button>

      <div className="mt-16 h-12 flex items-center justify-center gap-2">
        {isActive && !isDialing ? (
          [0.4, 0.7, 0.3, 0.9, 0.5, 0.8, 0.4].map((h, i) => (
            <div 
              key={i}
              className="w-1.5 bg-blue-500 rounded-full animate-wave" 
              style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
            ></div>
          ))
        ) : (
          <div className={`h-[2px] bg-white/10 transition-all duration-1000 ${isActive ? 'w-40' : 'w-20 opacity-0'}`}></div>
        )}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.5; }
          50% { transform: scaleY(1.4); opacity: 1; }
        }
        .animate-wave {
          animation: wave 0.8s ease-in-out infinite;
        }
      `}</style>

    </div>
  );
};

export default VoiceController;
