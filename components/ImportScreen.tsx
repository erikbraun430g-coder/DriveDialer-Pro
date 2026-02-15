
import React, { useState, useEffect } from 'react';
import { Contact } from '../types';

interface ImportScreenProps {
  onDataLoaded: (contacts: Contact[]) => void;
  onBack: () => void;
}

const ImportScreen: React.FC<ImportScreenProps> = ({ onDataLoaded, onBack }) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const savedUrl = localStorage.getItem('drivedialer_sheet_url');
    if (savedUrl) setUrl(savedUrl);
  }, []);

  const parseCSVLine = (text: string) => {
    const result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const handleImport = async () => {
    if (!url.includes('docs.google.com/spreadsheets')) {
      setError('Plak de "Publiceren op internet" CSV link.');
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      let fetchUrl = url;
      if (!fetchUrl.includes('output=csv')) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'output=csv';
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('Kon sheet niet ophalen.');
      
      const text = await response.text();
      const rows = text.split(/\r?\n/).filter(row => row.trim() !== '');
      
      // Sla de kopregel over
      const dataRows = rows.slice(1);

      const parsedContacts: Contact[] = dataRows.map((row, index) => {
        const cols = parseCSVLine(row);
        // We mappen specifiek op de door jou genoemde volgorde
        return {
          id: cols[0] || `id-${index}`,
          name: cols[1] || 'Naam Onbekend',
          relation: cols[2] || 'Geen Relatie Vermeld', // KOLOM C: Relatie
          subject: cols[3] || 'Geen Onderwerp',      // KOLOM D: Taak
          phone: cols[4] || '',                      // KOLOM E: Telefoon
          status: 'pending' as const
        };
      }).filter(c => c.phone !== '');

      if (parsedContacts.length === 0) throw new Error('Geen geldige rijen gevonden met een telefoonnummer.');

      localStorage.setItem('drivedialer_sheet_url', url);
      onDataLoaded(parsedContacts);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 px-2">
        <button onClick={onBack} className="p-3 bg-slate-900 rounded-2xl text-slate-400 border border-slate-800 transition-colors active:bg-slate-800">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <h2 className="text-xl font-black uppercase tracking-widest text-white">Lijst Importeren</h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase">Google Sheets Verbinding</p>
        </div>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 p-8 rounded-[48px] space-y-8">
        <div className="space-y-3">
          <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-2">CSV Publicatie Link</label>
          <input 
            type="text" 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Plak hier de link..."
            className="w-full bg-slate-950 border border-slate-800 rounded-[24px] px-6 py-5 text-sm text-blue-400 focus:outline-none focus:border-blue-500 transition-all font-mono"
          />
        </div>

        {error && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-bold font-mono">⚠️ {error}</div>}

        <button 
          onClick={handleImport}
          disabled={isSyncing || !url}
          className="w-full bg-blue-600 hover:bg-blue-500 py-6 rounded-[28px] font-black uppercase tracking-[0.2em] text-white transition-all active:scale-95 shadow-xl shadow-blue-600/20"
        >
          {isSyncing ? 'Synchroniseren...' : '🔄 Lijst Laden'}
        </button>

        <div className="p-6 bg-slate-950/50 rounded-3xl border border-slate-800/50">
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-3">Verwachte Kolomvolgorde:</p>
          <div className="grid grid-cols-5 gap-2 text-center text-[8px] font-bold text-slate-400 uppercase">
            <div className="p-2 border border-slate-800 rounded-lg bg-slate-900">ID</div>
            <div className="p-2 border border-slate-800 rounded-lg bg-slate-900">Naam</div>
            <div className="p-2 border border-blue-900/50 rounded-lg bg-blue-900/10 text-blue-400">Relatie</div>
            <div className="p-2 border border-slate-800 rounded-lg bg-slate-900">Taak</div>
            <div className="p-2 border border-slate-800 rounded-lg bg-slate-900">Tel.</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportScreen;
