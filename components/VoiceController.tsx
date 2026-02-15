
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

const VoiceController: React.FC<VoiceControllerProps> = ({ contacts, currentIndex, setCurrentIndex, onCallComplete }) => {
  const [isActive, setIsActive] = useState(false);
  const [isStaged, setIsStaged] = useState(false); 
  const [status, setStatus] = useState('Systeem Gereed');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const currentContact = contacts[currentIndex];

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentContact?.name || 'DriveDialer',
        artist: currentContact?.subject || 'Klaar om te bellen',
        artwork: [{ src: 'https://cdn-icons-png.flaticon.com/512/103/103085.png', sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('play', () => isStaged ? makeCall() : startVoiceSession());
    }
  }, [currentContact, isStaged]);

  const decodeAudioData = async (data: Uint8Array, ctx: AudioContext) => {
    const dataInt16 = new Int16Array(data.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  };

  const stopVoiceSession = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (sessionRef.current) try { sessionRef.current.close(); } catch (e) {}
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    setIsActive(false);
    setStatus('Systeem Gereed');
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
      setStatus(`${contacts[foundIdx].name} gevonden`);
      return `Gevonden: ${contacts[foundIdx].name} over ${contacts[foundIdx].subject}. Druk op play op je stuur of de rode knop om te bellen.`;
    }
    return `Niet gevonden.`;
  }, [contacts, setCurrentIndex]);

  const startVoiceSession = async () => {
    if (isActive) { stopVoiceSession(); return; }
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setStatus('Luisteren...');
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              sessionPromise.then(s => {
                if (!streamRef.current) return;
                const input = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
                const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
                s.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio && audioContextRef.current) {
              const u8 = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
              const buf = await decodeAudioData(u8, audioContextRef.current);
              const src = audioContextRef.current.createBufferSource();
              src.buffer = buf;
              src.connect(audioContextRef.current.destination);
              const start = Math.max(nextStartTimeRef.current, audioContextRef.current.currentTime);
              src.start(start);
              nextStartTimeRef.current = start + buf.duration;
              sourcesRef.current.add(src);
            }
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                let res = "";
                if (fc.name === 'makeCall') res = makeCall();
                if (fc.name === 'findContactByName') res = findContactByName(fc.args.name as string);
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: res } } }));
              }
            }
            if (msg.serverContent?.turnComplete) setTimeout(() => stopVoiceSession(), 1800);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Start het bellen.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'findContactByName', description: 'Zoek een contact op naam.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } }
          ]}] as any,
          systemInstruction: `Je bent de DriveDialer Assistent. Je helpt de bestuurder hands-free te bellen. Wees extreem kort en zakelijk.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) { setIsActive(false); }
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
        <button 
          onClick={startVoiceSession}
          className={`aspect-square rounded-[64px] flex flex-col items-center justify-center transition-all duration-500 active:scale-95 shadow-2xl relative ${
            isActive ? 'bg-blue-500 animate-pulse' : 'bg-blue-800'
          }`}
        >
          <span className="text-white font-black text-6xl lg:text-7xl uppercase tracking-[0.2em]">START</span>
          <p className="mt-4 text-[10px] font-black text-blue-200 uppercase tracking-widest">{isActive ? 'Luisteren...' : 'Stemherkenning'}</p>
        </button>

        <button 
          onClick={makeCall}
          className={`aspect-square rounded-[64px] flex flex-col items-center justify-center p-12 text-center transition-all duration-500 active:scale-95 shadow-2xl border-4 ${
            isStaged ? 'bg-red-500 border-white shadow-[0_0_80px_rgba(239,68,68,0.5)]' : 'bg-red-900 border-transparent hover:bg-red-800'
          }`}
        >
          <span className="text-red-300 text-[10px] font-black uppercase tracking-[0.4em] mb-4">Huidig Contact</span>
          <h2 className="font-black text-white text-5xl lg:text-6xl uppercase tracking-tighter break-words">
            {currentContact?.name || '---'}
          </h2>
          <div className="mt-8 px-6 py-2 bg-black/20 rounded-full">
            <span className="text-xs font-black text-white uppercase tracking-widest">
              {isStaged ? 'Bevestig Bellen' : 'Druk om te bellen'}
            </span>
          </div>
        </button>
      </div>
      <div className="mt-12 text-center opacity-30">
        <p className="text-[10px] font-black uppercase tracking-[0.5em]">{status}</p>
      </div>
    </div>
  );
};

export default VoiceController;
