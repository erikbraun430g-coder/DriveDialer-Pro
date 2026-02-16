
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
      if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.replace(/\/edit.*$/, '/export?format=csv');
      const response = await fetch(fetchUrl);
      const text = await response.text();
      
      const rows = text.split(/\r?\n/).filter(l => l.trim()).map(line => {
        const sep = line.includes(';') ? ';' : ',';
        return line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
      });

      const parsed: Contact[] = rows.slice(1).map((cols, i) => ({
        id: cols[0] || `r-${i}`,
        name: cols[1] || 'Onbekend',
        relation: cols[2] || '',
        subject: cols[3] || '',
        phone: cols[4] || '',
        status: 'pending' as const
      })).filter(c => c.phone.length > 5);

      localStorage.setItem('drivedialer_sheet_url', url);
      onDataLoaded(parsed);
    } catch (e) {
      alert('Fout bij importeren.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <div className="bg-white/5 p-8 rounded-[40px] border border-white/10">
        <h2 className="text-xl font-black uppercase mb-4">Lijst laden</h2>
        <input 
          type="text" 
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Google Sheets URL..."
          className="w-full bg-black border border-white/20 rounded-2xl p-4 text-blue-400 outline-none"
        />
      </div>
      <button 
        onClick={handleImport}
        className="bg-blue-600 py-6 rounded-[32px] font-black uppercase text-white shadow-2xl active:scale-95"
      >
        {isSyncing ? 'LADEN...' : 'SYNCHRONISEER'}
      </button>
      <button onClick={onBack} className="py-4 text-white/30 uppercase text-[10px] font-bold">Annuleren</button>
    </div>
  );
};

export default ImportScreen;
