
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

// Helper functies conform Google GenAI SDK richtlijnen
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
  const [status, setStatus] = useState('Systeem Gereed');
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const currentContact = contacts[currentIndex];
  const nextContact = contacts[currentIndex + 1];

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
    const numChannels = 1;
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, 24000);

    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  };

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
      return `Gevonden: ${contacts[foundIdx].name} over ${contacts[foundIdx].subject}. Klik op de rode knop om te bellen.`;
    }
    return `Niet gevonden.`;
  }, [contacts, setCurrentIndex]);

  const startVoiceSession = async () => {
    if (isActive) { stopVoiceSession(); return; }
    
    try {
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setStatus('Ik luister...');
      setIsActive(true);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            if (!inputAudioContextRef.current) return;
            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              sessionPromise.then(s => {
                if (!isActive || !streamRef.current) return;
                const input = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) {
                  int16[i] = input[i] * 32768;
                }
                const base64 = encode(new Uint8Array(int16.buffer));
                s.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(processor);
            processor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Audio output verwerken
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const audioBytes = decode(base64Audio);
              const buffer = await decodeAudioData(audioBytes, outputAudioContextRef.current);
              const source = outputAudioContextRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAudioContextRef.current.destination);
              
              const startTime = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
              sourcesRef.current.add(source);
              setStatus('Aan het praten...');
            }

            // Gebruiker Transcriptie (voor debugging in console)
            if (msg.serverContent?.inputTranscription) {
              console.log("AI hoorde:", msg.serverContent.inputTranscription.text);
            }

            // Functie aanroepen
            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                let result = "";
                if (fc.name === 'makeCall') result = makeCall();
                if (fc.name === 'findContactByName') {
                  const args = fc.args as any;
                  result = findContactByName(args?.name || "");
                }
                sessionPromise.then(s => s.sendToolResponse({ 
                  functionResponses: { id: fc.id, name: fc.name, response: { result } } 
                }));
              }
            }
            
            if (msg.serverContent?.turnComplete) {
              setStatus('Ik luister...');
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          },
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Start het bellen van de geselecteerde persoon.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'findContactByName', description: 'Zoek een contact op naam uit de lijst.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } }
          ]}] as any,
          systemInstruction: `Je bent de DriveDialer Assistent. Je helpt de bestuurder hands-free te bellen.
            
            LIJST MET TAKEN:
            1. Eerste taak: ${currentContact?.name || 'geen'} over "${currentContact?.subject || 'geen'}".
            2. Volgende taak: ${nextContact?.name || 'geen'} over "${nextContact?.subject || 'geen'}".
            
            GEDRAG:
            - Als de gebruiker vraagt om de eerste taak of persoon voor te lezen, noem dan de naam en het onderwerp.
            - Wees extreem kort en zakelijk. Gebruik geen lange introducties.
            - Spreek Nederlands.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) { 
      console.error(e);
      setIsActive(false); 
      setStatus('Fout bij microfoon');
    }
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
        <button 
          onClick={startVoiceSession}
          className={`h-40 md:h-64 rounded-[40px] flex flex-col items-center justify-center transition-all duration-500 active:scale-95 shadow-2xl relative border-4 ${
            isActive ? 'bg-blue-500 border-blue-300 animate-pulse' : 'bg-blue-900 border-transparent'
          }`}
        >
          <span className="text-white font-black text-4xl sm:text-6xl uppercase tracking-[0.1em]">
            {isActive ? 'STOP' : 'START'}
          </span>
          <p className="mt-2 text-[8px] font-black text-blue-200 uppercase tracking-widest">
            {isActive ? 'Tik om te stoppen' : 'Tik voor spraak'}
          </p>
        </button>

        <button 
          onClick={makeCall}
          className={`h-40 md:h-64 rounded-[40px] flex flex-col items-center justify-center p-6 text-center transition-all duration-500 active:scale-95 shadow-2xl border-4 ${
            isStaged ? 'bg-red-500 border-white shadow-[0_0_80px_rgba(239,68,68,0.4)]' : 'bg-red-900 border-transparent hover:bg-red-800'
          }`}
        >
          <span className="text-red-300 text-[8px] font-black uppercase tracking-[0.3em] mb-1">Nu Bellen</span>
          <h2 className="font-black text-white text-2xl sm:text-4xl uppercase tracking-tighter line-clamp-1">
            {currentContact?.name || '---'}
          </h2>
          <div className="mt-3 px-4 py-1 bg-black/20 rounded-full">
            <span className="text-[9px] font-black text-white uppercase tracking-widest">
              {isStaged ? 'BEVESTIG' : 'TIK OM TE BELLEN'}
            </span>
          </div>
        </button>
      </div>
      <div className="mt-4 text-center">
        <span className="inline-block px-4 py-1 bg-white/5 rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-white/40">
          {status}
        </span>
      </div>
    </div>
  );
};

export default VoiceController;
