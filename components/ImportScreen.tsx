
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
      
      // We slaan de header (rij 1) altijd over
      const dataRows = rows.slice(1);

      const parsedContacts: Contact[] = dataRows.map((row, index) => {
        const cols = parseCSVLine(row);
        return {
          id: cols[0] || `id-${index}`,
          name: cols[1] || 'Onbekend',
          relation: cols[2] || 'Geen relatie', // Kolom C
          subject: cols[3] || 'Geen onderwerp', // Kolom D
          phone: cols[4] || '', // Kolom E
          status: 'pending' as const
        };
      }).filter(c => c.phone !== '');

      if (parsedContacts.length === 0) throw new Error('Geen geldige rijen gevonden.');

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
        <button onClick={onBack} className="p-3 bg-slate-900 rounded-2xl text-slate-400 border border-slate-800">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <h2 className="text-xl font-black uppercase tracking-widest text-white">Importeer Lijst</h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase">Google Sheets CSV Link</p>
        </div>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-[40px] space-y-6">
        <input 
          type="text" 
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/.../pub?output=csv"
          className="w-full bg-slate-950 border border-slate-800 rounded-[24px] px-6 py-5 text-sm text-blue-400 focus:outline-none font-mono"
        />

        {error && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-bold">{error}</div>}

        <button 
          onClick={handleImport}
          disabled={isSyncing || !url}
          className="w-full bg-blue-600 py-5 rounded-[28px] font-black uppercase tracking-[0.2em] text-white transition-all active:scale-95"
        >
          {isSyncing ? 'Laden...' : '🔄 Synchroniseren'}
        </button>

        <div className="pt-6 border-t border-slate-800/50 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
          A: ID | B: NAAM | C: RELATIE | D: TAAK | E: TELEFOON
        </div>
      </div>
    </div>
  );
};

export default ImportScreen;
