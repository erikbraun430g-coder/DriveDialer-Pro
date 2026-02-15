
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
      if (char === '"') inQuote = !inQuote;
      else if (char === ',' && !inQuote) {
        result.push(cur.trim());
        cur = '';
      } else cur += char;
    }
    result.push(cur.trim());
    return result;
  };

  const handleImport = async () => {
    if (!url.includes('docs.google.com/spreadsheets')) {
      setError('Plak de CSV link.');
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
      const dataRows = rows.slice(1);
      const parsedContacts: Contact[] = dataRows.map((row, index) => {
        const cols = parseCSVLine(row);
        return {
          id: cols[0] || `id-${index}`,
          name: cols[1] || 'Onbekend',
          relation: cols[2] || '',
          subject: cols[3] || '',
          phone: cols[4] || '',
          status: 'pending' as const
        };
      }).filter(c => c.phone !== '');
      if (parsedContacts.length === 0) throw new Error('Geen geldige nummers.');
      localStorage.setItem('drivedialer_sheet_url', url);
      onDataLoaded(parsedContacts);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-8 animate-in fade-in duration-500">
      <div className="px-2">
        <h2 className="text-xl font-bold text-white mb-1 uppercase tracking-tight">Instellingen</h2>
        <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Importeer je Google Sheet</p>
      </div>

      <div className="space-y-6">
        <input 
          type="text" 
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Google Sheet CSV URL..."
          className="w-full bg-white/5 border border-white/10 rounded-3xl px-6 py-5 text-sm text-blue-400 focus:outline-none focus:border-blue-500 transition-all font-mono"
        />

        {error && <div className="text-red-500 text-[10px] font-bold uppercase text-center px-4 tracking-tighter">⚠️ {error}</div>}

        <button 
          onClick={handleImport}
          disabled={isSyncing || !url}
          className="w-full bg-blue-600 py-6 rounded-3xl font-black uppercase tracking-widest text-white shadow-xl shadow-blue-600/20 active:scale-95 transition-transform"
        >
          {isSyncing ? 'Bezig...' : 'Lijst Laden'}
        </button>

        <button onClick={onBack} className="w-full py-4 text-[10px] font-bold text-white/20 uppercase tracking-[0.3em]">
          Terug naar Dialer
        </button>
      </div>
    </div>
  );
};

export default ImportScreen;
