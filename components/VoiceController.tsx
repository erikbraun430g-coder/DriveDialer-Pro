
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

// Hulpmiddelen voor audio-codering
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
  const [volume, setVolume] = useState(0);
  
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
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
    
    if (inputAudioCtxRef.current) inputAudioCtxRef.current.close();
    if (outputAudioCtxRef.current) outputAudioCtxRef.current.close();
    
    setIsActive(false);
    setVolume(0);
    setStatus('Assistent Gestopt');
  }, []);

  const makeCall = useCallback(() => {
    if (!currentContact) return "Geen contact.";
    const phone = currentContact.phone.replace(/\s+/g, '');
    window.location.href = `tel:${phone}`;
    onCallComplete(currentContact.id);
    return `Ik start de oproep naar ${currentContact.name}.`;
  }, [currentContact, onCallComplete]);

  const findContactByName = useCallback((name: string) => {
    const foundIdx = contacts.findIndex(c => c.name.toLowerCase().includes(name.toLowerCase()));
    if (foundIdx !== -1) {
      setCurrentIndex(foundIdx);
      return `Gevonden: ${contacts[foundIdx].name} bij ${contacts[foundIdx].relation}. Zal ik bellen?`;
    }
    return `Ik kan ${name} niet vinden.`;
  }, [contacts, setCurrentIndex]);

  const startVoiceSession = async () => {
    if (isActive) { stopVoiceSession(); return; }
    
    try {
      setStatus('Microfoon activeren...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Gebruik twee aparte contexts: 16k voor input (Gemini eis) en 24k voor output
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioCtx({ sampleRate: 16000 });
      const outputCtx = new AudioCtx({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;

      await inputCtx.resume();
      await outputCtx.resume();

      setStatus('Verbinden met AI...');

      const contactDatabase = contacts.map((c, i) => 
        `CONTACT ${i + 1}:
        - Naam: ${c.name}
        - Relatie: ${c.relation}
        - Taak: ${c.subject}
        - Tel: ${c.phone}`
      ).join('\n\n');

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setStatus('Ik luister...');
            
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            // Volume meter logica
            const analyser = inputCtx.createAnalyser();
            analyser.fftSize = 256;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            source.connect(analyser);

            const updateVolume = () => {
              if (!isActive && !streamRef.current) return;
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
              setVolume(sum / dataArray.length);
              if (streamRef.current) requestAnimationFrame(updateVolume);
            };
            updateVolume();

            processor.onaudioprocess = (e) => {
              sessionPromise.then(s => {
                if (!streamRef.current) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  int16[i] = inputData[i] * 32768;
                }
                const base64 = encode(new Uint8Array(int16.buffer));
                s.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioCtxRef.current) {
              const audioBytes = decode(base64Audio);
              const dataInt16 = new Int16Array(audioBytes.buffer);
              const buffer = outputAudioCtxRef.current.createBuffer(1, dataInt16.length, 24000);
              const channelData = buffer.getChannelData(0);
              for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
              
              const source = outputAudioCtxRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAudioCtxRef.current.destination);
              const startTime = Math.max(nextStartTimeRef.current, outputAudioCtxRef.current.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
              sourcesRef.current.add(source);
              setStatus('AI spreekt...');
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
          },
          onerror: (e) => {
            console.error(e);
            setStatus('Verbinding verbroken');
            stopVoiceSession();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { voiceName: 'Puck' } as any },
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Bel het geselecteerde contact.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'findContactByName', description: 'Zoek iemand op naam.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } }
          ]}] as any,
          systemInstruction: `Je bent DriveDialer, een assistent voor in de auto. 
          
          DATA:
          ${contactDatabase}
          
          INSTRUCTIES:
          1. De chauffeur is nu bij ${currentContact?.name || 'niets'}.
          2. Noem bij ELKE vraag over een contactpersoon: NAAM, RELATIE, TAAK en NUMMER.
          3. Je hebt ALTIJD toegang tot de data hierboven. Zeg NOOIT dat je de spreadsheet niet kunt zien.
          4. Gebruik 'makeCall' om te bellen.
          5. Wees extreem kortaf. Veiligheid boven alles. Nederlands spreken.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) { 
      console.error(e);
      setStatus('Fout: ' + (e as any).message);
      setIsActive(false); 
    }
  };

  return (
    <div className="w-full space-y-8">
      <div className="relative flex justify-center items-center">
        {/* Volume Visualizer Ring */}
        {isActive && (
          <div 
            className="absolute rounded-full border-4 border-blue-500/30 transition-all duration-75"
            style={{ 
              width: `${240 + (volume * 2)}px`, 
              height: `${240 + (volume * 2)}px`,
              opacity: volume > 5 ? 1 : 0.2
            }}
          />
        )}
        
        <button 
          onClick={startVoiceSession} 
          className={`relative z-10 w-64 h-64 rounded-full flex flex-col items-center justify-center transition-all active:scale-90 shadow-[0_0_50px_rgba(37,99,235,0.2)] border-8 ${
            isActive ? 'bg-blue-600 border-white animate-none' : 'bg-slate-900 border-slate-800'
          }`}
        >
          <div className={`w-20 h-20 rounded-full mb-4 flex items-center justify-center ${isActive ? 'bg-white text-blue-600 shadow-inner' : 'bg-blue-600 text-white'}`}>
            {isActive ? (
              <div className="flex gap-1">
                <div className="w-1.5 h-8 bg-current rounded-full animate-bounce" style={{animationDelay: '0s'}}></div>
                <div className="w-1.5 h-12 bg-current rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div className="w-1.5 h-6 bg-current rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
            ) : (
              <svg className="w-10 h-10 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            )}
          </div>
          <span className="text-white font-black text-2xl uppercase tracking-widest">{isActive ? 'STOP' : 'START'}</span>
          <p className="mt-2 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">{status}</p>
        </button>
      </div>

      {currentContact && (
        <div className="bg-gradient-to-b from-white/10 to-transparent border border-white/10 rounded-[40px] p-8 text-center shadow-2xl">
          <div className="flex justify-center gap-2 mb-4">
             <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-[9px] font-black uppercase tracking-widest border border-blue-500/30">Huidige Selectie</span>
          </div>
          <h2 className="text-3xl font-black text-white uppercase tracking-tight mb-1">{currentContact.name}</h2>
          <p className="text-blue-500 font-bold uppercase tracking-[0.2em] text-xs mb-4">{currentContact.relation}</p>
          
          <div className="flex flex-col gap-2 bg-black/40 rounded-3xl p-4 border border-white/5">
             <div className="flex justify-between items-center text-[10px] border-b border-white/5 pb-2">
                <span className="text-white/30 uppercase font-bold">Onderwerp</span>
                <span className="text-white font-bold">{currentContact.subject}</span>
             </div>
             <div className="flex justify-between items-center text-[10px] pt-1">
                <span className="text-white/30 uppercase font-bold">Telefoon</span>
                <span className="text-blue-400 font-mono font-bold tracking-widest">{currentContact.phone}</span>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceController;
