
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

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const VoiceController: React.FC<VoiceControllerProps> = ({ contacts, currentIndex, setCurrentIndex, onCallComplete }) => {
  const [isActive, setIsActive] = useState(false);
  const [volume, setVolume] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [aiTranscript, setAiTranscript] = useState('');
  
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
    setTranscript('');
    setAiTranscript('');
  }, []);

  const makeCall = useCallback(() => {
    if (!currentContact) return "Geen contact.";
    const phone = currentContact.phone.replace(/\s+/g, '');
    window.location.href = `tel:${phone}`;
    onCallComplete(currentContact.id);
    return "Ik start de oproep.";
  }, [currentContact, onCallComplete]);

  const findContactByName = useCallback((name: string) => {
    const foundIdx = contacts.findIndex(c => 
      c.name.toLowerCase().includes(name.toLowerCase()) || 
      c.relation.toLowerCase().includes(name.toLowerCase())
    );
    if (foundIdx !== -1) {
      setCurrentIndex(foundIdx);
      return `Gevonden: ${contacts[foundIdx].name}. Bellen?`;
    }
    return "Niet gevonden.";
  }, [contacts, setCurrentIndex]);

  const startVoiceSession = async () => {
    if (isActive) { stopVoiceSession(); return; }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
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
        `ID:${i+1} | ${c.name} | Bedrijf:${c.relation} | Taak:${c.subject} | Tel:${c.phone}`
      ).join('\n');

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(2048, 1, 1);
            
            const analyser = inputCtx.createAnalyser();
            analyser.fftSize = 64;
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
              if (!sessionRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionRef.current.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.inputTranscription) setTranscript(msg.serverContent.inputTranscription.text);
            if (msg.serverContent?.outputTranscription) setAiTranscript(msg.serverContent.outputTranscription.text);
            
            const parts = msg.serverContent?.modelTurn?.parts;
            if (parts && outputAudioCtxRef.current) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  const audioBuffer = await decodeAudioData(decode(part.inlineData.data), outputAudioCtxRef.current, 24000, 1);
                  const source = outputAudioCtxRef.current.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(outputAudioCtxRef.current.destination);
                  const startTime = Math.max(nextStartTimeRef.current, outputAudioCtxRef.current.currentTime);
                  source.start(startTime);
                  nextStartTimeRef.current = startTime + audioBuffer.duration;
                  sourcesRef.current.add(source);
                }
              }
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                let res = fc.name === 'makeCall' ? makeCall() : findContactByName((fc.args as any)?.name || "");
                sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: res } } });
              }
            }

            if (msg.serverContent?.interrupted) {
               sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
               sourcesRef.current.clear();
               nextStartTimeRef.current = 0;
            }
          },
          onerror: () => stopVoiceSession(),
          onclose: () => setIsActive(false)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { voiceName: 'Puck' } as any },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [
            { name: 'makeCall', description: 'Bel het contact.', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'findContactByName', description: 'Zoek op naam.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } }
          ]}] as any,
          systemInstruction: `Je bent DriveDialer. 
          DATA: ${contactData}. 
          REGELS: 
          1. Zeg ONMIDDELLIJK 'Systeem online' bij start.
          2. Noem bij vragen Naam en Bedrijf (Relatie). 
          3. Gebruik 'makeCall' om te bellen. 
          4. Wees extreem kortaf. Nederlands.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e: any) { 
      setIsActive(false); 
    }
  };

  return (
    <div className="w-full flex flex-col items-center space-y-8">
      <div className="relative">
        {/* Pulsing visualizer background */}
        {isActive && (
          <div 
            className="absolute inset-0 rounded-full bg-blue-600/20 blur-xl transition-all duration-75 scale-150"
            style={{ opacity: volume / 100 }}
          />
        )}
        
        <button 
          onClick={startVoiceSession} 
          className={`relative w-56 h-56 rounded-full flex flex-col items-center justify-center transition-all active:scale-90 border-[10px] ${
            isActive ? 'bg-blue-600 border-white shadow-2xl' : 'bg-slate-900 border-slate-800'
          }`}
        >
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-3 ${isActive ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'}`}>
            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
          </div>
          <span className="text-white font-black text-2xl tracking-tighter">{isActive ? 'STOP' : 'START'}</span>
        </button>
      </div>

      {/* Transcriptie feedback */}
      <div className="h-12 flex flex-col items-center justify-center px-6">
        {isActive && (
          <div className="text-center">
            {transcript && <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">{transcript}</p>}
            {aiTranscript && <p className="text-lg text-blue-400 font-black uppercase mt-1 leading-none">{aiTranscript}</p>}
          </div>
        )}
      </div>

      {/* Simple Contact Name Display */}
      {currentContact && (
        <div className="text-center pt-4">
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.4em] mb-2">Huidige Selectie</p>
          <h2 className="text-5xl font-black text-white uppercase tracking-tighter leading-none">{currentContact.name}</h2>
          <p className="text-xl font-bold text-white/20 uppercase mt-2 tracking-widest">{currentContact.relation}</p>
        </div>
      )}
    </div>
  );
};

export default VoiceController;
