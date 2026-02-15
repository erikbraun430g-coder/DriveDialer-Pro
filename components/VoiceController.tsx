
import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const VoiceController: React.FC<VoiceControllerProps> = ({ contacts, currentIndex, setCurrentIndex, onCallComplete }) => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState('Systeem Gereed');
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const currentContact = contacts[currentIndex];

  const stopVoiceSession = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    setIsActive(false);
    setStatus('Gereed voor start');
  }, []);

  const makeCall = useCallback(() => {
    if (!currentContact) return "Fout: geen contact geselecteerd.";
    // We stoppen de sessie even om de telefoonlijn vrij te maken
    const phone = currentContact.phone.replace(/\s+/g, '');
    setStatus(`Bellen: ${currentContact.name}...`);
    window.location.href = `tel:${phone}`;
    onCallComplete(currentContact.id);
    return `Ik start nu het gesprek met ${currentContact.name}.`;
  }, [currentContact, onCallComplete]);

  const findContactByName = useCallback((name: string) => {
    const foundIdx = contacts.findIndex(c => c.name.toLowerCase().includes(name.toLowerCase()));
    if (foundIdx !== -1) {
      setCurrentIndex(foundIdx);
      return `Gevonden: ${contacts[foundIdx].name} van de relatie ${contacts[foundIdx].relation}. Zal ik bellen?`;
    }
    return `Ik kan ${name} niet vinden in je huidige lijst.`;
  }, [contacts, setCurrentIndex]);

  const startVoiceSession = async () => {
    if (isActive) { stopVoiceSession(); return; }
    
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setStatus('Assistent verbindt...');

      // DATASTRUCTUUR VOOR AI
      const contactDatabase = contacts.map((c, i) => 
        `REGEL ${i + 1}:
        - Naam: ${c.name}
        - Relatie (Bedrijf): ${c.relation}
        - Onderwerp (Taak): ${c.subject}
        - Telefoon: ${c.phone}`
      ).join('\n\n');

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setStatus('Ik luister nu...');
            const source = ctx.createMediaStreamSource(stream);
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              sessionPromise.then(s => {
                if (!streamRef.current) return;
                const inputData = e.inputBuffer.getChannelData(0);
                // Resample naar 16kHz
                const ratio = ctx.sampleRate / 16000;
                const newLength = Math.round(inputData.length / ratio);
                const resampledData = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) resampledData[i] = inputData[Math.round(i * ratio)];
                const int16 = new Int16Array(resampledData.length);
                for (let i = 0; i < resampledData.length; i++) int16[i] = resampledData[i] * 32768;
                s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(processor);
            processor.connect(ctx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioCtxRef.current) {
              const audioBytes = decode(base64Audio);
              const dataInt16 = new Int16Array(audioBytes.buffer);
              const buffer = audioCtxRef.current.createBuffer(1, dataInt16.length, 24000);
              const channelData = buffer.getChannelData(0);
              for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
              const source = audioCtxRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(audioCtxRef.current.destination);
              const startTime = Math.max(nextStartTimeRef.current, audioCtxRef.current.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
              sourcesRef.current.add(source);
            }
            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                let res = "";
                if (fc.name === 'makeCall') res = makeCall();
                if (fc.name === 'findContactByName') res = findContactByName((fc.args as any)?.name || "");
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: res } } }));
              }
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { voiceName: 'Puck' } as any },
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Start direct het bellen naar het huidige contact.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'findContactByName', description: 'Zoek iemand in de lijst op naam.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } }
          ]}] as any,
          systemInstruction: `Je bent de DriveDialer Assistent. Je helpt een chauffeur met bellen.
            
            GEBRUIK DEZE DATA (VERPLICHT):
            ${contactDatabase}
            
            INSTRUCTIES:
            1. De gebruiker staat nu bij Regel ${currentIndex + 1}.
            2. Als de gebruiker vraagt om informatie over een regel of contact, noem ALTIJD: 
               - De Naam
               - De Relatie (het bedrijf)
               - Het Onderwerp
               - Het Nummer
            3. Noem NOOIT dat je geen toegang hebt tot de spreadsheet. Alle informatie staat hierboven.
            4. Wees zeer kort en krachtig. Geen lange inleidingen.
            5. Als de gebruiker zegt "bel hem", "bel haar" of "start gesprek", gebruik 'makeCall'.
            6. Spreek Nederlands.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) { 
      setStatus('Systeem Fout');
      setIsActive(false); 
    }
  };

  return (
    <div className="w-full space-y-6">
      <button 
        onClick={startVoiceSession} 
        className={`w-full h-64 rounded-[48px] flex flex-col items-center justify-center transition-all active:scale-95 shadow-2xl border-8 ${
          isActive ? 'bg-blue-600 border-blue-400 animate-pulse' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className={`w-24 h-24 rounded-full mb-6 flex items-center justify-center ${isActive ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'}`}>
          {isActive ? (
            <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          ) : (
            <svg className="w-12 h-12 ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          )}
        </div>
        <span className="text-white font-black text-4xl uppercase tracking-[0.2em]">{isActive ? 'LUISTEREN' : 'START ASSISTENT'}</span>
        <p className="mt-4 text-[10px] font-bold text-blue-400 uppercase tracking-[0.3em]">{status}</p>
      </button>

      {currentContact && (
        <div className="bg-white/5 border border-white/10 rounded-[32px] p-6 flex flex-col items-center text-center">
          <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-2">Huidige Selectie</span>
          <h2 className="text-2xl font-black text-white uppercase">{currentContact.name}</h2>
          <p className="text-sm font-bold text-white/50 mt-1">{currentContact.relation}</p>
          <div className="mt-4 px-6 py-2 bg-blue-500/10 rounded-full border border-blue-500/20">
            <span className="text-[10px] font-mono text-blue-400">{currentContact.phone}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceController;
