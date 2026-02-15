
import React, { useState, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";

const PhotoAnalyzer: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setAnalysis(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async () => {
    if (!selectedImage) return;
    setLoading(true);
    setAnalysis(null);

    try {
      const base64Data = selectedImage.split(',')[1];
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
            { text: "Analyze this image of a car dashboard. Identify any warning lights or indicators visible. Explain what they mean, how severe the issue is (Low, Medium, High, or Critical), and what immediate steps the driver should take." }
          ]
        }
      });

      setAnalysis(response.text || "Unable to analyze the image. Please ensure the dashboard is clearly visible.");
    } catch (error) {
      console.error("Analysis Error:", error);
      setAnalysis("Error communicating with AI. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      <header>
        <h2 className="text-3xl font-bold">Dashboard Analyzer</h2>
        <p className="text-slate-400">Upload a photo of your dashboard lights for an instant AI diagnostic.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex flex-col gap-6">
          <div 
            className={`flex-1 min-h-[300px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
              selectedImage ? 'border-blue-500 bg-slate-800/30' : 'border-slate-700 hover:border-slate-600 bg-slate-800/10'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            {selectedImage ? (
              <img src={selectedImage} alt="Dashboard Preview" className="max-h-full rounded-lg object-contain" />
            ) : (
              <div className="text-center p-6">
                <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <p className="text-slate-400 font-medium">Click to upload or drag & drop</p>
                <p className="text-slate-600 text-sm mt-1">Supports JPG, PNG</p>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              className="hidden" 
              accept="image/*" 
            />
          </div>

          <div className="flex gap-4">
            <button 
              onClick={() => setSelectedImage(null)}
              className="flex-1 px-4 py-3 border border-slate-700 rounded-xl text-slate-300 font-bold hover:bg-slate-800 transition-colors"
            >
              Clear
            </button>
            <button 
              onClick={analyzeImage}
              disabled={!selectedImage || loading}
              className="flex-[2] bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Analyzing...
                </span>
              ) : 'Start Diagnostic'}
            </button>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            AI Insight
          </h3>
          {analysis ? (
            <div className="prose prose-invert max-w-none prose-sm leading-relaxed whitespace-pre-wrap text-slate-300 bg-slate-800/50 p-6 rounded-xl border border-slate-700">
              {analysis}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 italic p-12 text-center border border-dashed border-slate-800 rounded-xl">
              <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Upload a photo and click "Start Diagnostic" to get an AI-powered report on your car's health.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PhotoAnalyzer;
