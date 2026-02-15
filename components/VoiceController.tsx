
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

// Low-level audio utilities voor maximale snelheid
function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, sampleRate);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
  return buffer;
}

const VoiceController: React.FC<VoiceControllerProps> = ({ contacts, currentIndex, setCurrentIndex, onCallComplete }) => {
  const [isActive, setIsActive] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [volume, setVolume] = useState(0);
  const [aiText, setAiText] = useState('');
  
  // Refs voor rigoureus geheugenbeheer
  const audioCtxInRef = useRef<AudioContext | null>(null);
  const audioCtxOutRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const currentContact = contacts[currentIndex];

  // Microfoon en cache volledig vrijgeven
  const stopAndReleaseEverything = useCallback(() => {
    console.log("Releasing microphone and clearing cache...");
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }

    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    
    if (audioCtxInRef.current) {
      audioCtxInRef.current.close().catch(() => {});
      audioCtxInRef.current = null;
    }
    if (audioCtxOutRef.current) {
      audioCtxOutRef.current.close().catch(() => {});
      audioCtxOutRef.current = null;
    }

    nextStartTimeRef.current = 0;
    setIsActive(false);
    setIsInitializing(false);
    setVolume(0);
  }, []);

  const triggerCall = useCallback(() => {
    if (!currentContact) return "Geen contact.";
    const cleanNumber = currentContact.phone.replace(/[^0-9+]/g, '');
    
    // Belangrijk: Eerst alles stoppen (mic vrijgeven!) dan bellen
    const contactId = currentContact.id;
    stopAndReleaseEverything();
    
    // Start het systeem-bel-proces
    window.location.href = `tel:${cleanNumber}`;
    onCallComplete(contactId);
    
    return "Gesprek wordt gestart.";
  }, [currentContact, onCallComplete, stopAndReleaseEverything]);

  const skipToNext = useCallback(() => {
    if (currentIndex < contacts.length - 1) {
      setCurrentIndex(currentIndex + 1);
      // We herstarten de sessie niet automatisch om verwarring te voorkomen
      stopAndReleaseEverything();
      return "Volgende geladen.";
    }
    stopAndReleaseEverything();
    return "Einde lijst.";
  }, [currentIndex, contacts.length, setCurrentIndex, stopAndReleaseEverything]);

  const startVoiceAssistant = async () => {
    if (isActive) { stopAndReleaseEverything(); return; }
    
    setIsInitializing(true);
    try {
      // 1. Mic aanvragen
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true } 
      });
      streamRef.current = stream;

      // 2. Audio contexts opzetten
      const inCtx = new AudioContext({ sampleRate: 16000 });
      const outCtx = new AudioContext({ sampleRate: 24000 });
      await Promise.all([inCtx.resume(), outCtx.resume()]);
      audioCtxInRef.current = inCtx;
      audioCtxOutRef.current = outCtx;

      // 3. AI Verbinden
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const info = currentContact 
        ? `${currentContact.name} van ${currentContact.relation}, taak: ${currentContact.subject}` 
        : "Geen info";

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setIsInitializing(false);
            
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
                media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } 
              });
              
              analyser.getByteFrequencyData(dataArray);
              setVolume(Math.max(...Array.from(dataArray)));
            };
            source.connect(processor);
            processor.connect(inCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.outputTranscription?.text) {
              setAiText(msg.serverContent.outputTranscription.text);
            }

            // Audio output van AI afspelen
            if (msg.serverContent?.modelTurn?.parts) {
              for (const part of msg.serverContent.modelTurn.parts) {
                if (part.inlineData?.data && audioCtxOutRef.current) {
                  const buf = await decodeAudioData(decode(part.inlineData.data), audioCtxOutRef.current, 24000);
                  const source = audioCtxOutRef.current.createBufferSource();
                  source.buffer = buf;
                  source.connect(audioCtxOutRef.current.destination);
                  const startTime = Math.max(nextStartTimeRef.current, audioCtxOutRef.current.currentTime);
                  source.start(startTime);
                  nextStartTimeRef.current = startTime + buf.duration;
                  sourcesRef.current.add(source);
                  source.onended = () => sourcesRef.current.delete(source);
                }
              }
            }

            // Functies uitvoeren (Bellen of Volgende)
            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                let res = "";
                if (fc.name === 'makeCall') res = triggerCall();
                if (fc.name === 'skipContact') res = skipToNext();
                
                if (sessionRef.current) {
                    sessionRef.current.sendToolResponse({ 
                        functionResponses: { id: fc.id, name: fc.name, response: { result: res } } 
                    });
                }
              }
            }

            if (msg.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => { console.error(e); stopAndReleaseEverything(); },
          onclose: () => stopAndReleaseEverything()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { voiceName: 'Puck' } as any },
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Start het telefoongesprek met de huidige persoon.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'skipContact', description: 'Sla deze persoon over en ga naar de volgende.', parameters: { type: Type.OBJECT, properties: {} } }
          ]}] as any,
          systemInstruction: `Je bent de DriveDialer rij-assistent.
          HUIDIG CONTACT: ${info}.
          
          TASK:
          Lees direct bij opstarten voor: "Drive Dialer staat klaar. We gaan ${currentContact?.name} van ${currentContact?.relation} bellen voor ${currentContact?.subject}. Zal ik de verbinding starten?"
          
          INSTRUCTIES:
          1. Als de gebruiker bevestigt (Ja, bel maar, start), gebruik 'makeCall'.
          2. Als de gebruiker weigert (Nee, volgende, later), gebruik 'skipContact'.
          3. Wees zeer kort en krachtig. Nederlands.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error(e);
      stopAndReleaseEverything();
    }
  };

  useEffect(() => () => stopAndReleaseEverything(), [stopAndReleaseEverything]);

  return (
    <div className="flex flex-col items-center w-full space-y-12 h-full justify-center">
      
      {/* Grote bedieningsknop */}
      <div className="relative">
        <div className={`absolute inset-0 rounded-full blur-3xl transition-all duration-300 scale-150 ${
          isActive ? 'bg-blue-500/30' : 'bg-transparent'
        }`} style={{ opacity: isActive ? 0.2 + (volume / 255) : 0 }} />
        
        <button 
          onClick={startVoiceAssistant}
          disabled={isInitializing}
          className={`relative w-72 h-72 rounded-full flex flex-col items-center justify-center border-[18px] transition-all active:scale-90 ${
            isActive ? 'bg-blue-600 border-white shadow-2xl' : 'bg-slate-900 border-slate-800 shadow-lg'
          } ${isInitializing ? 'animate-pulse opacity-50' : ''}`}
        >
          <div className="text-6xl mb-3">
            {isActive ? '⏹️' : '🎙️'}
          </div>
          <span className="text-white font-black text-3xl uppercase tracking-tighter">
            {isInitializing ? '...' : isActive ? 'STOP' : 'START'}
          </span>
        </button>
      </div>

      {/* AI Status / Feedback */}
      <div className="h-12 text-center px-4">
        {isActive && (
          <p className="text-xl font-bold text-blue-400 uppercase tracking-tight animate-in fade-in slide-in-from-bottom-2">
            {aiText || "Ik luister naar je..."}
          </p>
        )}
      </div>

      {/* Contact Details (Extra groot voor leesbaarheid tijdens rijden) */}
      {currentContact && (
        <div className="w-full text-center space-y-6 pt-4">
          <div className="space-y-2">
            <p className="text-blue-500 font-black text-xs uppercase tracking-[0.5em] opacity-60">Volgende taak:</p>
            <h2 className="text-8xl font-black text-white uppercase tracking-tighter leading-[0.85] px-2 break-words">
              {currentContact.name}
            </h2>
          </div>
          
          <div className="space-y-4">
            <p className="text-4xl font-bold text-white/50 uppercase tracking-widest italic">
              {currentContact.relation}
            </p>
            <div className="inline-block bg-white/5 border border-white/10 px-8 py-4 rounded-3xl">
              <p className="text-sm font-black text-blue-400 uppercase tracking-widest mb-1">Onderwerp:</p>
              <p className="text-2xl font-bold text-white uppercase">{currentContact.subject}</p>
            </div>
          </div>
        </div>
      )}

      {/* Handmatige Skip-knop als backup */}
      {!isActive && currentContact && (
        <button 
          onClick={() => setCurrentIndex(currentIndex + 1)}
          className="text-white/20 font-black uppercase text-xs tracking-widest mt-4 hover:text-white transition-colors"
        >
          Overslaan ⏭️
        </button>
      )}
    </div>
  );
};

export default VoiceController;
