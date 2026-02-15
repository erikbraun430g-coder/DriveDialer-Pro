
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
  const [isStaged, setIsStaged] = useState(false); 
  const [status, setStatus] = useState('Tik op Start');
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const currentContact = contacts[currentIndex];
  const nextContact = contacts[currentIndex + 1];

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
    setStatus('Gereed');
  }, []);

  const makeCall = useCallback(() => {
    if (!currentContact) return "Geen contact";
    stopVoiceSession();
    setIsStaged(false);
    setStatus(`Bellen...`);
    window.open(`tel:${currentContact.phone.replace(/\s+/g, '')}`, '_self');
    onCallComplete(currentContact.id);
    return "ok";
  }, [currentContact, onCallComplete, stopVoiceSession]);

  const findContactByName = useCallback((name: string) => {
    const foundIdx = contacts.findIndex(c => c.name.toLowerCase().includes(name.toLowerCase()));
    if (foundIdx !== -1) {
      setCurrentIndex(foundIdx);
      setIsStaged(true);
      return `Gevonden: ${contacts[foundIdx].name}. Je kunt nu bellen.`;
    }
    return `Niet gevonden in de lijst.`;
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
      setStatus('Verbinden...');

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setStatus('Ik luister...');
            
            const source = ctx.createMediaStreamSource(stream);
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              sessionPromise.then(s => {
                if (!streamRef.current) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const ratio = ctx.sampleRate / 16000;
                const newLength = Math.round(inputData.length / ratio);
                const resampledData = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) {
                  resampledData[i] = inputData[Math.round(i * ratio)];
                }

                const int16 = new Int16Array(resampledData.length);
                for (let i = 0; i < resampledData.length; i++) int16[i] = resampledData[i] * 32768;
                const base64 = encode(new Uint8Array(int16.buffer));
                s.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
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
              setStatus('Antwoorden...');
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                let res = "";
                if (fc.name === 'makeCall') res = makeCall();
                if (fc.name === 'findContactByName') res = findContactByName((fc.args as any)?.name || "");
                sessionPromise.then(s => s.sendToolResponse({ 
                  functionResponses: { id: fc.id, name: fc.name, response: { result: res } } 
                }));
              }
            }
            if (msg.serverContent?.turnComplete) setStatus('Ik luister...');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Start het bellen.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'findContactByName', description: 'Zoek iemand op naam.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } }
          ]}] as any,
          systemInstruction: `Je bent de DriveDialer Assistent. Help de bestuurder hands-free te bellen.
            
            HUIDIGE TAAK (EERSTE REGEL):
            - Naam: ${currentContact?.name || 'Leeg'}
            - Organisatie: ${currentContact?.organization || 'Niet vermeld'}
            - Onderwerp/Taak: ${currentContact?.subject || 'Geen details'}
            - Telefoon: ${currentContact?.phone || 'Geen nummer'}
            
            VOLGENDE TAAK (TWEEDE REGEL):
            - Naam: ${nextContact?.name || 'Niemand'}
            - Organisatie: ${nextContact?.organization || ''}
            
            GEDRAG:
            - Als de gebruiker vraagt: "lees de eerste taak voor" of "lees de eerste regel uit de excel voor", lees dan ALLES voor: de naam, het bedrijf, het onderwerp en het telefoonnummer.
            - Wees kort en zakelijk. Zeg niet: "natuurlijk lees ik dat voor". Zeg gewoon direct: "De eerste regel is..."
            - Als ze vragen om te bellen, gebruik de 'makeCall' tool.
            - Spreek Nederlands.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) { 
      console.error(e);
      setStatus('Fout bij microfoon');
      setIsActive(false); 
    }
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button 
          onClick={startVoiceSession}
          className={`h-40 md:h-56 rounded-[32px] flex flex-col items-center justify-center transition-all active:scale-95 shadow-2xl border-4 ${
            isActive ? 'bg-blue-600 border-blue-400 animate-pulse' : 'bg-blue-900 border-transparent'
          }`}
        >
          <span className="text-white font-black text-4xl uppercase tracking-widest">{isActive ? 'STOP' : 'START'}</span>
          <p className="mt-2 text-[10px] font-bold text-blue-200 uppercase tracking-[0.2em] opacity-60">Spraak Assistent</p>
        </button>

        <button 
          onClick={makeCall}
          className={`h-40 md:h-56 rounded-[32px] flex flex-col items-center justify-center p-6 text-center transition-all active:scale-95 shadow-2xl border-4 ${
            isStaged ? 'bg-red-600 border-white' : 'bg-red-950 border-transparent'
          }`}
        >
          <span className="text-red-400 text-[9px] font-black uppercase tracking-[0.3em] mb-1">Nu Bellen</span>
          <h2 className="font-black text-white text-2xl uppercase tracking-tighter line-clamp-1">
            {currentContact?.name || 'GEEN'}
          </h2>
          <p className="text-[10px] text-white/40 font-bold uppercase mt-1">{currentContact?.organization || ''}</p>
          <div className="mt-2 px-4 py-1 bg-black/30 rounded-full">
            <span className="text-[10px] font-black text-white uppercase tracking-widest">TIK OM TE BELLEN</span>
          </div>
        </button>
      </div>
      <div className="mt-4 text-center">
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500/50">{status}</span>
      </div>
    </div>
  );
};

export default VoiceController;
