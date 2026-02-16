
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

  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    const result: string[][] = [];
    // Detecteer separator (vaak ; in NL sheets, anders ,)
    const firstLine = lines[0];
    const sep = firstLine.includes(';') ? ';' : ',';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const row: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === sep && !inQuotes) {
          row.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      row.push(current.trim().replace(/^"|"$/g, ''));
      result.push(row);
    }
    return result;
  };

  const handleImport = async () => {
    if (!url) return;
    setIsSyncing(true);
    setError(null);
    try {
      let fetchUrl = url;
      if (fetchUrl.includes('/edit')) {
        fetchUrl = fetchUrl.replace(/\/edit.*$/, '/export?format=csv');
      } else if (!fetchUrl.includes('format=csv')) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'format=csv';
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('Kon blad niet laden. Controleer of delen op "Iedereen met de link" staat.');
      
      const text = await response.text();
      const rows = parseCSV(text);
      
      // We verwachten: ID (0), Naam (1), Relatie (2), Onderwerp (3), Telefoon (4)
      const dataRows = rows.slice(1); // Skip header
      const parsed: Contact[] = dataRows
        .map((cols, i) => ({
          id: cols[0] || `r-${i + 1}`,
          name: cols[1] || '',
          relation: cols[2] || '',
          subject: cols[3] || '',
          phone: cols[4] || '',
          status: 'pending' as const
        }))
        .filter(c => c.name.length > 1 && c.phone.length > 5);

      if (parsed.length === 0) throw new Error('Geen geldige rijen gevonden. Check de kolommen: 2=Naam, 5=Telefoon.');
      
      localStorage.setItem('drivedialer_sheet_url', url);
      onDataLoaded(parsed);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-6 animate-in fade-in duration-500">
      <div className="bg-white/5 p-8 rounded-[40px] border border-white/10">
        <h2 className="text-xl font-black uppercase tracking-tight mb-4">Spreadsheet Koppelen</h2>
        <input 
          type="text" 
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Plak Google Sheets URL..."
          className="w-full bg-black border border-white/20 rounded-2xl px-6 py-4 text-blue-400 text-sm focus:border-blue-500 outline-none transition-all"
        />
        {error && <p className="text-red-500 text-[10px] font-bold uppercase mt-4 px-2 tracking-tight">⚠️ {error}</p>}
      </div>

      <button 
        onClick={handleImport}
        disabled={isSyncing || !url}
        className="w-full bg-blue-600 py-6 rounded-[32px] font-black uppercase tracking-widest text-white shadow-2xl active:scale-95 transition-all disabled:opacity-20"
      >
        {isSyncing ? 'DATA OPHALEN...' : 'SYNCHRONISEER NU'}
      </button>

      <button onClick={onBack} className="text-center text-white/30 uppercase text-[10px] font-bold tracking-[0.3em] py-4">
        Annuleren
      </button>
    </div>
  );
};

export default ImportScreen;
