
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

  // Verbeterde CSV parser die omgaat met quotes en komma's binnen velden
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
      if (!response.ok) throw new Error('Kon sheet niet ophalen. Is hij wel openbaar gepubliceerd?');
      
      const text = await response.text();
      const rows = text.split(/\r?\n/).filter(row => row.trim() !== '');
      
      // Sla header over als die er is (check of de eerste rij 'id' of 'naam' bevat)
      const startIdx = rows[0].toLowerCase().includes('naam') || rows[0].toLowerCase().includes('id') ? 1 : 0;
      const dataRows = rows.slice(startIdx);

      const parsedContacts: Contact[] = dataRows.map((row, index) => {
        const columns = parseCSVLine(row);
        return {
          id: columns[0] || `id-${index}`,
          name: columns[1] || 'Onbekend',
          subject: columns[2] || 'Geen onderwerp',
          phone: columns[3] || '',
          status: 'pending' as const
        };
      }).filter(c => c.phone !== '');

      if (parsedContacts.length === 0) {
        throw new Error('Geen geldige contacten gevonden. Zorg dat de kolommen kloppen.');
      }

      localStorage.setItem('drivedialer_sheet_url', url);
      setSuccessCount(parsedContacts.length);
      
      // Geef de gebruiker even tijd om het succes te zien
      setTimeout(() => {
        onDataLoaded(parsedContacts);
      }, 1000);

    } catch (err: any) {
      setError(err.message || 'Fout bij synchroniseren.');
      console.error(err);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-3 bg-slate-900 rounded-2xl text-slate-400 hover:text-white border border-slate-800 transition-colors">
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

      <div className="bg-slate-900/80 border border-slate-800 p-6 md:p-8 rounded-[40px] shadow-2xl space-y-8 backdrop-blur-xl">
        {/* Input Sectie */}
        <div className="space-y-4">
          <div className="flex justify-between items-end">
            <label className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">Google Sheets CSV URL</label>
            {successCount && (
              <span className="text-[10px] font-bold text-green-500 animate-bounce">✓ {successCount} contacten geladen</span>
            )}
          </div>
          <div className="relative">
             <input 
              type="text" 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Plak hier de .csv link..."
              className={`w-full bg-slate-950 border ${error ? 'border-red-500/50' : 'border-slate-800'} rounded-[24px] px-6 py-5 text-sm text-blue-400 focus:outline-none focus:border-blue-500 transition-all font-mono`}
            />
            {isSyncing && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className="w-5 h-5 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-bold flex items-center gap-3">
            <span className="text-lg">⚠️</span>
            {error}
          </div>
        )}

        <button 
          onClick={handleImport}
          disabled={isSyncing || !url}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-5 rounded-[28px] font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-900/20 active:scale-95 transition-all text-white flex items-center justify-center gap-3"
        >
          {isSyncing ? 'Synchroniseren...' : '🔄 Update Bellijst'}
        </button>

        {/* Instructie Sectie */}
        <div className="pt-8 border-t border-slate-800/50">
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 text-center">Hoe haal ik de link op?</h4>
          
          <div className="grid grid-cols-1 gap-4">
            {[
              { step: '1', text: 'Zet je data in kolommen: ID, Naam, Onderwerp, Telefoon', icon: '📊' },
              { step: '2', text: 'Ga naar Bestand > Delen > Publiceren op internet', icon: '🌍' },
              { step: '3', text: 'Selecteer "Door komma\'s gescheiden waarden (.csv)"', icon: '📑' },
              { step: '4', text: 'Klik op Publiceren en kopieer de link die verschijnt', icon: '🔗' }
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-4 p-4 bg-slate-950/50 rounded-2xl border border-slate-800/40">
                <span className="flex-shrink-0 w-8 h-8 bg-slate-900 rounded-xl flex items-center justify-center text-sm border border-slate-800 font-black text-blue-500">
                  {item.step}
                </span>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed pt-1">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-center">
        <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Veilige verbinding via HTTPS</p>
      </div>
    </div>
  );
};

export default ImportScreen;
