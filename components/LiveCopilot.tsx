
import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';

const LiveCopilot: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [transcription, setTranscription] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<string>('');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // PCM Decoding utility
  const decodeAudioData = async (data: Uint8Array, ctx: AudioContext) => {
    const dataInt16 = new Int16Array(data.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
  };

  const startSession = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
              session.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
            };
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (msg) => {
            if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const audioBytes = Uint8Array.from(atob(msg.serverContent.modelTurn.parts[0].inlineData.data), c => c.charCodeAt(0));
              const buffer = await decodeAudioData(audioBytes, audioContextRef.current!);
              const source = audioContextRef.current!.createBufferSource();
              source.buffer = buffer;
              source.connect(audioContextRef.current!.destination);
              const startAt = Math.max(nextStartTimeRef.current, audioContextRef.current!.currentTime);
              source.start(startAt);
              nextStartTimeRef.current = startAt + buffer.duration;
              sourcesRef.current.add(source);
            }
            if (msg.serverContent?.outputTranscription) {
              setAiResponse(prev => prev + msg.serverContent!.outputTranscription!.text);
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "You are the DriveAssist Pro voice co-pilot. Help the driver with car info, route advice, or simple conversation. Keep responses short and helpful for safety."
        }
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-[70vh] space-y-8 animate-fadeIn">
      <div className={`relative w-48 h-48 flex items-center justify-center rounded-full transition-all duration-700 ${isActive ? 'bg-cyan-500/20 scale-110 shadow-[0_0_50px_rgba(6,182,212,0.5)]' : 'bg-slate-800'}`}>
        {isActive && (
          <div className="absolute inset-0 rounded-full animate-ping bg-cyan-500/30"></div>
        )}
        <button 
          onClick={isActive ? () => window.location.reload() : startSession}
          className={`z-10 w-32 h-32 rounded-full flex items-center justify-center text-white transition-transform active:scale-95 shadow-2xl ${isActive ? 'bg-cyan-600' : 'bg-blue-600'}`}
        >
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isActive ? (
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            ) : (
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            )}
          </svg>
        </button>
      </div>

      <div className="text-center max-w-md">
        <h2 className="text-2xl font-bold mb-2">{isActive ? 'Listening...' : 'Hands-free Mode'}</h2>
        <p className="text-slate-400">
          {isActive ? 'Talk naturally. I can help you while you drive.' : 'Tap the icon to start a voice conversation with your co-pilot.'}
        </p>
      </div>

      {aiResponse && (
        <div className="bg-slate-900/80 backdrop-blur border border-slate-800 p-6 rounded-2xl max-w-xl text-center shadow-xl">
          <p className="text-cyan-400 font-medium">{aiResponse}</p>
        </div>
      )}
    </div>
  );
};

export default LiveCopilot;
