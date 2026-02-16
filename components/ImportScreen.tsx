
import React, { useState, useEffect } from 'react';
import { Contact } from '../types';

interface ImportScreenProps {
  onDataLoaded: (contacts: Contact[]) => void;
  onBack: () => void;
}

const ImportScreen: React.FC<ImportScreenProps> = ({ onDataLoaded, onBack }) => {
  const [url, setUrl] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('drivedialer_sheet_url');
    if (saved) setUrl(saved);
  }, []);

  const handleImport = async () => {
    if (!url) return;
    setIsSyncing(true);
    try {
      let fetchUrl = url;
      if (fetchUrl.includes('/edit')) {
        fetchUrl = fetchUrl.replace(/\/edit.*$/, '/export?format=csv');
      } else if (!fetchUrl.includes('format=csv')) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'format=csv';
      }

      const response = await fetch(fetchUrl);
      const text = await response.text();
      
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 5);
      const rows = lines.map(line => {
        const sep = line.includes(';') ? ';' : ',';
        const parts: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let char of line) {
          if (char === '"') inQuotes = !inQuotes;
          else if (char === sep && !inQuotes) {
            parts.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        parts.push(current.trim());
        return parts.map(p => p.replace(/^"|"$/g, ''));
      });

      // Mapping: 0=ID, 1=Naam, 2=Bedrijf, 3=Onderwerp, 4=Telefoon
      const parsed: Contact[] = rows.slice(1).map((cols, i) => ({
        id: cols[0] || `r-${i}`,
        name: cols[1] || 'Onbekend',
        relation: cols[2] || '',
        subject: cols[3] || '',
        phone: cols[4] || '',
        status: 'pending' as const
      })).filter(c => c.name.length > 1 && c.phone.length > 5);

      if (parsed.length === 0) throw new Error('Geen geldige data.');

      localStorage.setItem('drivedialer_sheet_url', url);
      onDataLoaded(parsed);
    } catch (e) {
      alert('Controleer de Sheets link (moet Iedereen met de link zijn).');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-8 animate-in fade-in duration-500">
      <div className="bg-white/5 p-8 rounded-[40px] border border-white/10">
        <h2 className="text-xl font-black uppercase tracking-tight mb-4">Lijst laden</h2>
        <input 
          type="text" 
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Plak Google Sheets URL..."
          className="w-full bg-black border border-white/20 rounded-2xl px-6 py-4 text-blue-400 text-sm focus:border-blue-500 outline-none transition-all"
        />
      </div>

      <button 
        onClick={handleImport}
        disabled={isSyncing}
        className="w-full bg-blue-600 py-6 rounded-[35px] font-black uppercase tracking-widest text-white shadow-2xl active:scale-95 disabled:opacity-20"
      >
        {isSyncing ? 'DATA OPHALEN...' : 'SYNCHRONISEER NU'}
      </button>

      <button onClick={onBack} className="text-center text-white/30 uppercase text-[10px] font-bold tracking-[0.4em] py-4">
        Annuleren
      </button>
    </div>
  );
};

export default ImportScreen;
