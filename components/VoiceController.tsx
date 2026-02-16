
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

  const handleDial = useCallback((index?: number) => {
    // Als er een index wordt meegegeven (1-based), gebruik die, anders de huidige focus
    const targetIdx = (typeof index === 'number' && index > 0) ? index - 1 : currentIndex;
    const contact = contacts[targetIdx];
    
    if (!contact) return;
    
    const phone = contact.phone.replace(/[^0-9+]/g, '');
    const id = contact.id;
    
    // Start de oproep direct via het protocol
    window.location.href = `tel:${phone}`;
    
    // Geef de browser even de tijd om de dialer te openen voordat we de state updaten en de sessie sluiten
    setTimeout(() => {
      onCallComplete(id);
      cleanup();
    }, 1000);
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

      // Bouw een zeer gedetailleerde context voor de AI zodat hij alles over elk contact weet
      const detailedList = contacts.map((c, i) => 
        `Taak ${i + 1}: Naam: ${c.name}, Organisatie: ${c.relation}, Onderwerp: ${c.subject}, Telefoon: ${c.phone}`
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
              description: 'Start het daadwerkelijke telefoongesprek.', 
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER, description: 'Optioneel: het nummer op de lijst' } } } 
            },
            { 
              name: 'goto', 
              description: 'Verander de focus van het scherm naar een specifiek contactpersoon zonder te bellen.', 
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER, description: 'Het nummer op de lijst (1-gebaseerd)' } }, required: ['index'] } 
            },
            { 
              name: 'skip', 
              description: 'Ga naar de volgende persoon op de lijst.', 
              parameters: { type: Type.OBJECT, properties: {} } 
            }
          ]}] as any,
          systemInstruction: `Je bent een intelligente rij-assistent voor DriveDialer. Je hebt de VOLLEDIGE lijst met contacten en hun details in je geheugen:

          LIJST:
          ${detailedList}

          HUIDIGE STATUS:
          Je bent momenteel bij Taak #${currentIndex + 1}: ${currentContact?.name}.

          RICHTLIJNEN VOOR CONVERSATIE:
          1. Informatie geven: Als de gebruiker vraagt om details (bijv. "Bij welk bedrijf werkt hij?", "Wat is het onderwerp?", "Vertel meer over taak 5"), gebruik dan de data hierboven om een uitgebreid antwoord te geven. 
          2. Actief voorlezen: Als de gebruiker vraagt om een taak voor te lezen, noem dan altijd de Naam, Organisatie/Relatie EN het onderwerp. Vraag daarna of ze willen bellen.
          3. Bevestiging: Als de gebruiker "bellen", "graag bellen", "ja", of "doe maar" zegt, gebruik dan ALTIJD de 'dial' tool.
          4. Navigatie: Als de gebruiker vraagt naar een specifiek nummer op de lijst, gebruik 'goto' om dat contact op het scherm te tonen en lees de info voor.
          5. Toon: Wees zakelijk, behulpzaam en kort (voor de veiligheid in de auto). Spreek uitsluitend Nederlands.`
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
      
      {/* Informatie Paneel */}
      <div className="mb-20 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="inline-block px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">
          <span className="text-blue-500 font-black text-[10px] tracking-[0.3em] uppercase">
             Lijst Item {currentIndex + 1} van {contacts.length}
          </span>
        </div>
        <h2 className="text-3xl font-black text-white tracking-tighter uppercase mb-2">
          {currentContact?.name || "Klaar"}
        </h2>
        <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.2em]">
          {currentContact?.relation}
        </p>
      </div>

      {/* Centrale Actieknop */}
      <button 
        onClick={toggleSession}
        disabled={isConnecting}
        className={`relative w-full max-w-xs aspect-video rounded-[45px] font-black text-5xl tracking-[0.1em] transition-all flex items-center justify-center overflow-hidden shadow-2xl active:scale-95 ${
          isActive 
            ? 'bg-red-600 shadow-red-900/40' 
            : 'bg-blue-600 shadow-blue-900/40'
        } ${isConnecting ? 'opacity-50' : 'opacity-100'}`}
      >
        {/* Subtiele gloed animatie bij activiteit */}
        {isActive && (
          <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
        )}
        <span className="relative z-10">
          {isConnecting ? '...' : isActive ? 'STOP' : 'START'}
        </span>
      </button>

      {/* Audio Visualizer (Minimalistisch) */}
      <div className="mt-16 h-12 flex items-center justify-center gap-1.5 w-full max-w-[200px]">
        {isActive ? (
          <>
            {[0.4, 0.7, 0.3, 0.9, 0.5, 0.8].map((h, i) => (
              <div 
                key={i}
                className="w-1.5 bg-blue-500 rounded-full animate-wave" 
                style={{ 
                  height: `${h * 100}%`,
                  animationDelay: `${i * 0.1}s`
                }}
              ></div>
            ))}
          </>
        ) : (
          <div className="w-full h-[1px] bg-white/10"></div>
        )}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1.2); }
        }
        .animate-wave {
          animation: wave 1s ease-in-out infinite;
        }
      `}</style>

    </div>
  );
};

export default VoiceController;
