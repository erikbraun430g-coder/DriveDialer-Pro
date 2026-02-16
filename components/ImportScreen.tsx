
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
    const rows: string[][] = [];
    const lines = text.split(/\r?\n/);
    lines.forEach(line => {
      if (!line.trim()) return;
      const row: string[] = [];
      let current = '';
      let inQuotes = false;
      const sep = line.includes(';') ? ';' : ',';
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === sep && !inQuotes) {
          row.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else current += char;
      }
      row.push(current.trim().replace(/^"|"$/g, ''));
      rows.push(row);
    });
    return rows;
  };

  const handleImport = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      let fetchUrl = url;
      if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.replace(/\/edit.*$/, '/export?format=csv');
      else if (!fetchUrl.includes('format=csv')) fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'format=csv';

      const response = await fetch(fetchUrl);
      const text = await response.text();
      const allRows = parseCSV(text);
      
      const dataRows = allRows.slice(1); // Skip header
      const parsed = dataRows.map((cols, i) => ({
        id: cols[0] || `row-${i+1}`,
        name: cols[1] || 'Onbekend',
        relation: cols[2] || '',
        subject: cols[3] || '',
        phone: cols[4] || '',
        status: 'pending' as const
      })).filter(c => c.name !== 'Onbekend');

      if (parsed.length === 0) throw new Error('Geen data gevonden.');
      
      localStorage.setItem('drivedialer_sheet_url', url);
      onDataLoaded(parsed);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-8 p-4">
      <h2 className="text-xl font-black uppercase tracking-tighter">Sync Spreadsheet</h2>
      <input 
        type="text" 
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Google Sheets URL..."
        className="w-full bg-white/10 p-6 rounded-3xl text-blue-400"
      />
      {error && <p className="text-red-500 text-xs font-bold">{error}</p>}
      <button onClick={handleImport} className="bg-blue-600 p-6 rounded-3xl font-black uppercase">
        {isSyncing ? 'Synchroniseren...' : 'Update Lijst'}
      </button>
      <button onClick={onBack} className="text-white/40 uppercase text-[10px] font-bold">Terug</button>
    </div>
  );
};

export default ImportScreen;
