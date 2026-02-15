
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
  const [successCount, setSuccessCount] = useState<number | null>(null);

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
      setError('Ongeldige link. Gebruik de "Publiceren op internet" link uit Google Sheets.');
      return;
    }

    setIsSyncing(true);
    setError(null);
    setSuccessCount(null);

    try {
      let fetchUrl = url;
      if (!fetchUrl.includes('output=csv')) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'output=csv';
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('Kon sheet niet ophalen. Is hij openbaar gepubliceerd?');
      
      const text = await response.text();
      const rows = text.split(/\r?\n/).filter(row => row.trim() !== '');
      
      const startIdx = rows[0].toLowerCase().includes('naam') || rows[0].toLowerCase().includes('id') ? 1 : 0;
      const dataRows = rows.slice(startIdx);

      const parsedContacts: Contact[] = dataRows.map((row, index) => {
        const columns = parseCSVLine(row);
        // Mapping: 0:ID, 1:Naam, 2:Organisatie, 3:Onderwerp, 4:Telefoon
        return {
          id: columns[0] || `id-${index}`,
          name: columns[1] || 'Onbekend',
          organization: columns[2] || '',
          subject: columns[3] || 'Geen onderwerp',
          phone: columns[4] || '',
          status: 'pending' as const
        };
      }).filter(c => c.phone !== '');

      if (parsedContacts.length === 0) {
        throw new Error('Geen geldige contacten gevonden. Zorg dat je minimaal 5 kolommen hebt.');
      }

      localStorage.setItem('drivedialer_sheet_url', url);
      setSuccessCount(parsedContacts.length);
      
      setTimeout(() => {
        onDataLoaded(parsedContacts);
      }, 1000);

    } catch (err: any) {
      setError(err.message || 'Fout bij synchroniseren.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-3 bg-slate-900 rounded-2xl text-slate-400 border border-slate-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="text-xl font-black uppercase tracking-widest text-white">Configuratie</h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Koppel je Google Sheet</p>
          </div>
        </div>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-[40px] shadow-2xl space-y-8 backdrop-blur-xl">
        <div className="space-y-4">
          <label className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">Google Sheets CSV URL</label>
          <input 
            type="text" 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Plak hier de .csv link..."
            className={`w-full bg-slate-950 border ${error ? 'border-red-500/50' : 'border-slate-800'} rounded-[24px] px-6 py-5 text-sm text-blue-400 focus:outline-none focus:border-blue-500 transition-all font-mono`}
          />
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-bold">
            ⚠️ {error}
          </div>
        )}

        <button 
          onClick={handleImport}
          disabled={isSyncing || !url}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-5 rounded-[28px] font-black uppercase tracking-[0.2em] text-white flex items-center justify-center gap-3 transition-all active:scale-95"
        >
          {isSyncing ? 'Laden...' : '🔄 Bellijst Bijwerken'}
        </button>

        <div className="pt-8 border-t border-slate-800/50">
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Verwachte Kolommen (Excel):</h4>
          <div className="p-4 bg-slate-950/50 rounded-2xl border border-slate-800/40 font-mono text-[9px] text-slate-400">
            A: ID | B: Naam | C: Organisatie | D: Taak/Onderwerp | E: Telefoon
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportScreen;
