
import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  const [status, setStatus] = useState('Klaar voor start');
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
    setStatus('Assistent uit');
  }, []);

  const makeCall = useCallback(() => {
    if (!currentContact) return "Geen contact.";
    const phone = currentContact.phone.replace(/\s+/g, '');
    setStatus(`Bellen...`);
    // We stoppen de audio even zodat de telefoon-app de mic kan overnemen
    setTimeout(() => {
      window.location.href = `tel:${phone}`;
    }, 500);
    onCallComplete(currentContact.id);
    return `Ik verbind u met ${currentContact.name}.`;
  }, [currentContact, onCallComplete]);

  const findContactByName = useCallback((name: string) => {
    const foundIdx = contacts.findIndex(c => 
      c.name.toLowerCase().includes(name.toLowerCase()) || 
      c.relation.toLowerCase().includes(name.toLowerCase())
    );
    if (foundIdx !== -1) {
      setCurrentIndex(foundIdx);
      return `Gevonden: ${contacts[foundIdx].name} van ${contacts[foundIdx].relation}. Zal ik bellen?`;
    }
    return `Ik kan ${name} niet vinden in de lijst.`;
  }, [contacts, setCurrentIndex]);

  const startVoiceSession = async () => {
    if (isActive) { stopVoiceSession(); return; }
    
    try {
      setStatus('Microfoon laden...');
      // Optimalisatie voor auto: echo cancellation en noise suppression aan
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioCtx({ sampleRate: 16000 });
      const outputCtx = new AudioCtx({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;

      await inputCtx.resume();
      await outputCtx.resume();

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const contactData = contacts.map((c, i) => 
        `ID ${i + 1}: ${c.name} | Bedrijf: ${c.relation} | Taak: ${c.subject} | Tel: ${c.phone}`
      ).join('\n');

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setStatus('Ik luister...');
            
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(2048, 1, 1);
            
            const analyser = inputCtx.createAnalyser();
            analyser.fftSize = 32;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            source.connect(analyser);

            const updateVolume = () => {
              if (!streamRef.current) return;
              analyser.getByteFrequencyData(dataArray);
              let max = 0;
              for(let i=0; i<dataArray.length; i++) if(dataArray[i] > max) max = dataArray[i];
              setVolume(max);
              requestAnimationFrame(updateVolume);
            };
            updateVolume();

            processor.onaudioprocess = (e) => {
              sessionPromise.then(s => {
                if (!streamRef.current) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
                s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
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
              setStatus('AI antwoordt...');
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                let res = "";
                if (fc.name === 'makeCall') res = makeCall();
                if (fc.name === 'findContactByName') res = findContactByName((fc.args as any)?.name || "");
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: res } } }));
              }
            }
            if (msg.serverContent?.turnComplete) setStatus('Ik luister...');
          },
          onerror: (e) => { setStatus('Verbinding fout'); stopVoiceSession(); }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { voiceName: 'Puck' } as any },
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Start het bellen.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'findContactByName', description: 'Zoek contact in lijst.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } }
          ]}] as any,
          systemInstruction: `Je bent DriveDialer, een assistent voor chauffeurs. 
          
          DATASET:
          ${contactData}
          
          CRUCIALE REGELS:
          1. De kolom 'Bedrijf' in de dataset hierboven IS de 'Relatie' uit de spreadsheet. Noem deze ALTIJD.
          2. Als de gebruiker vraagt wie hij moet bellen, noem dan: Naam, Relatie (Bedrijf), Taak en Telefoonnummer.
          3. Wees zeer kortaf. Gebruik maximaal 15 woorden per antwoord.
          4. Bij commando 'bel' of 'start gesprek', gebruik de tool 'makeCall'.
          5. Spreek uitsluitend Nederlands.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e: any) { 
      setStatus('Fout: ' + e.message);
      setIsActive(false); 
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col items-center">
        <button 
          onClick={startVoiceSession} 
          className={`relative w-64 h-64 rounded-full flex flex-col items-center justify-center transition-all active:scale-90 border-[12px] ${
            isActive ? 'bg-blue-600 border-white shadow-[0_0_80px_rgba(37,99,235,0.4)]' : 'bg-slate-900 border-slate-800 shadow-xl'
          }`}
        >
          {/* Audio Wave Effect */}
          {isActive && (
            <div 
              className="absolute inset-0 rounded-full border-4 border-blue-400 opacity-20 animate-ping"
              style={{ animationDuration: '2s' }}
            />
          )}

          <div className={`w-24 h-24 rounded-full mb-4 flex items-center justify-center transition-transform ${isActive ? 'scale-110 bg-white text-blue-600' : 'bg-blue-600 text-white'}`}>
            {isActive ? (
               <div className="flex items-end gap-1 h-8">
                 <div className="w-2 bg-current rounded-full transition-all" style={{ height: `${20 + (volume * 0.8)}%` }}></div>
                 <div className="w-2 bg-current rounded-full transition-all" style={{ height: `${40 + (volume * 0.4)}%` }}></div>
                 <div className="w-2 bg-current rounded-full transition-all" style={{ height: `${10 + (volume * 1.2)}%` }}></div>
               </div>
            ) : (
              <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            )}
          </div>
          <span className="text-white font-black text-3xl uppercase tracking-tighter">{isActive ? 'STOP' : 'START'}</span>
          <p className={`mt-2 text-[10px] font-bold uppercase tracking-widest ${isActive ? 'text-blue-200' : 'text-slate-500'}`}>{status}</p>
        </button>
      </div>

      {currentContact && (
        <div className="bg-slate-900/50 border border-white/10 rounded-[40px] p-8 shadow-2xl backdrop-blur-md">
          <div className="text-center space-y-2">
            <span className="inline-block px-4 py-1 bg-blue-500/10 text-blue-400 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-blue-500/20">Nu Actief</span>
            <h2 className="text-4xl font-black text-white uppercase tracking-tight leading-none pt-2">{currentContact.name}</h2>
            <div className="flex items-center justify-center gap-2">
               <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">RELATIE:</span>
               <p className="text-lg font-bold text-white/70 uppercase">{currentContact.relation}</p>
            </div>
          </div>
          
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div className="bg-black/40 p-5 rounded-3xl border border-white/5">
              <span className="text-[8px] font-black text-slate-500 uppercase block mb-1">Taak</span>
              <p className="text-xs font-bold text-white line-clamp-2">{currentContact.subject}</p>
            </div>
            <div className="bg-black/40 p-5 rounded-3xl border border-white/5">
              <span className="text-[8px] font-black text-slate-500 uppercase block mb-1">Telefoon</span>
              <p className="text-xs font-bold text-blue-400 font-mono">{currentContact.phone}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceController;
