
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

// Handmatige Base64 helpers voor maximale compatibiliteit
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

const VoiceController: React.FC<VoiceControllerProps> = ({ contacts, currentIndex, setCurrentIndex, onCallComplete }) => {
  const [status, setStatus] = useState<'idle' | 'starting' | 'active'>('idle');
  const [aiTranscript, setAiTranscript] = useState('');
  const [volume, setVolume] = useState(0);

  // Hardware Refs
  const audioContextIn = useRef<AudioContext | null>(null);
  const audioContextOut = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());

  const currentContact = contacts[currentIndex];

  // HARD RESET: Geeft microfoon vrij en leegt alle buffers
  const hardReset = useCallback(() => {
    console.log("Cleaning up hardware and releasing microphone...");
    
    // Stop microfoon stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Sluit AI Sessie
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }

    // Stop alle spelende audio
    activeSources.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeSources.current.clear();

    // Sluit Audio Contexts
    if (audioContextIn.current) {
      audioContextIn.current.close().catch(() => {});
      audioContextIn.current = null;
    }
    if (audioContextOut.current) {
      audioContextOut.current.close().catch(() => {});
      audioContextOut.current = null;
    }

    nextStartTimeRef.current = 0;
    setStatus('idle');
    setVolume(0);
    setAiTranscript('');
  }, []);

  const initiateCall = useCallback(() => {
    if (!currentContact) return "Fout: geen contact.";
    
    const phoneNumber = currentContact.phone.replace(/[^0-9+]/g, '');
    const contactId = currentContact.id;

    // CRUCIAAL: Eerst de mic vrijgeven, dan pas de systeem-oproep doen
    hardReset();
    
    // Trigger systeem bellen (werkt met autostuur/bluetooth)
    window.location.href = `tel:${phoneNumber}`;
    onCallComplete(contactId);
    
    return "Bellen gestart.";
  }, [currentContact, onCallComplete, hardReset]);

  const handleNext = useCallback(() => {
    if (currentIndex < contacts.length - 1) {
      setCurrentIndex(currentIndex + 1);
      hardReset();
      return "Volgende contact geladen.";
    }
    hardReset();
    return "Einde van de lijst.";
  }, [currentIndex, contacts.length, setCurrentIndex, hardReset]);

  const startAssistant = async () => {
    if (status !== 'idle') {
      hardReset();
      return;
    }

    setStatus('starting');
    try {
      // 1. Vraag microfoon aan
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });
      streamRef.current = stream;

      // 2. Initialiseer Audio Contexts (geactiveerd door user click)
      const inCtx = new AudioContext({ sampleRate: 16000 });
      const outCtx = new AudioContext({ sampleRate: 24000 });
      await Promise.all([inCtx.resume(), outCtx.resume()]);
      audioContextIn.current = inCtx;
      audioContextOut.current = outCtx;

      // 3. Start Gemini Live Sessie
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const contactInfo = `NAAM: ${currentContact.name}, BEDRIJF: ${currentContact.relation}, ONDERWERP: ${currentContact.subject}`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus('active');
            
            // Audio Input naar AI
            const source = inCtx.createMediaStreamSource(stream);
            const processor = inCtx.createScriptProcessor(4096, 1, 1);
            const analyser = inCtx.createAnalyser();
            analyser.fftSize = 32;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            
            source.connect(analyser);
            processor.onaudioprocess = (e) => {
              if (!sessionRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              
              sessionRef.current.sendRealtimeInput({ 
                media: { 
                  data: encodeBase64(new Uint8Array(int16.buffer)), 
                  mimeType: 'audio/pcm;rate=16000' 
                } 
              });

              analyser.getByteFrequencyData(dataArray);
              setVolume(Math.max(...Array.from(dataArray)));
            };
            source.connect(processor);
            processor.connect(inCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.outputTranscription?.text) {
              setAiTranscript(msg.serverContent.outputTranscription.text);
            }

            // AI Audio afspelen
            const parts = msg.serverContent?.modelTurn?.parts;
            if (parts && outCtx) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  const rawData = decodeBase64(part.inlineData.data);
                  const int16 = new Int16Array(rawData.buffer);
                  const buffer = outCtx.createBuffer(1, int16.length, 24000);
                  const channel = buffer.getChannelData(0);
                  for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768.0;

                  const source = outCtx.createBufferSource();
                  source.buffer = buffer;
                  source.connect(outCtx.destination);
                  
                  const startTime = Math.max(nextStartTimeRef.current, outCtx.currentTime);
                  source.start(startTime);
                  nextStartTimeRef.current = startTime + buffer.duration;
                  activeSources.current.add(source);
                  source.onended = () => activeSources.current.delete(source);
                }
              }
            }

            // Tool Calls (Bellen / Volgende)
            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                let result = "";
                if (fc.name === 'makeCall') result = initiateCall();
                if (fc.name === 'skipContact') result = handleNext();
                
                if (sessionRef.current) {
                  sessionRef.current.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result } }
                  });
                }
              }
            }

            if (msg.serverContent?.interrupted) {
              activeSources.current.forEach(s => s.stop());
              activeSources.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => { console.error("AI Error:", e); hardReset(); },
          onclose: () => hardReset()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { voiceName: 'Puck' } as any },
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Bel de huidige persoon direct.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'skipContact', description: 'Ga naar het volgende contact in de lijst.', parameters: { type: Type.OBJECT, properties: {} } }
          ]}] as any,
          systemInstruction: `Je bent DriveDialer. 
          HUIDIG CONTACT: ${contactInfo}.
          
          TASK:
          Lees direct bij start voor: "DriveDialer actief. Volgende is ${currentContact.name} van ${currentContact.relation} over ${currentContact.subject}. Zal ik bellen?"
          
          REGELS:
          1. Bij 'ja', 'bel maar', 'start': voer 'makeCall' uit.
          2. Bij 'nee', 'overslaan', 'volgende': voer 'skipContact' uit.
          3. Wees zeer kort en zakelijk. Nederlands.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error("Initialization Error:", e);
      hardReset();
    }
  };

  useEffect(() => () => hardReset(), [hardReset]);

  return (
    <div className="flex flex-col items-center justify-between h-full w-full py-8">
      
      {/* 1. Grote Bedieningsknop */}
      <div className="relative mt-8">
        <div className={`absolute inset-0 rounded-full blur-[80px] transition-all duration-500 scale-150 ${
          status === 'active' ? 'bg-blue-600/40' : 'bg-transparent'
        }`} style={{ opacity: status === 'active' ? 0.3 + (volume / 255) : 0 }} />
        
        <button 
          onClick={startAssistant}
          disabled={status === 'starting'}
          className={`relative w-80 h-80 rounded-full flex flex-col items-center justify-center border-[20px] transition-all active:scale-90 ${
            status === 'active' ? 'bg-blue-600 border-white shadow-[0_0_100px_rgba(37,99,235,0.4)]' : 'bg-slate-900 border-slate-800'
          } ${status === 'starting' ? 'animate-pulse' : ''}`}
        >
          <span className="text-7xl mb-4">
            {status === 'active' ? '⏹️' : '🎙️'}
          </span>
          <span className="text-white font-black text-3xl uppercase tracking-tighter">
            {status === 'starting' ? 'LADEN' : status === 'active' ? 'STOP' : 'START'}
          </span>
        </button>
      </div>

      {/* 2. Contact Informatie (Enorm voor in de auto) */}
      <div className="w-full text-center space-y-6">
        <div className="px-4">
          <p className="text-blue-500 font-black text-sm uppercase tracking-[0.5em] mb-2">Nu op de lijst:</p>
          <h2 className="text-8xl font-black text-white uppercase tracking-tighter leading-[0.8] break-words">
            {currentContact?.name}
          </h2>
        </div>
        
        <div className="space-y-4">
          <p className="text-4xl font-bold text-white/40 uppercase tracking-widest italic leading-none">
            {currentContact?.relation}
          </p>
          <div className="inline-block bg-white/5 border border-white/10 px-10 py-5 rounded-[40px]">
            <p className="text-xs font-black text-blue-400 uppercase tracking-widest mb-1 italic">Te bespreken:</p>
            <p className="text-2xl font-bold text-white uppercase">{currentContact?.subject}</p>
          </div>
        </div>
      </div>

      {/* 3. Feedback / Transcript */}
      <div className="h-16 flex items-center justify-center text-center px-6">
        {status === 'active' && (
          <p className="text-2xl font-black text-blue-400 uppercase tracking-tight animate-pulse">
            {aiTranscript || "Ik luister..."}
          </p>
        )}
      </div>

    </div>
  );
};

export default VoiceController;
