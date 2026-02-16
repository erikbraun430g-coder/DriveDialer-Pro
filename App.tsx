
import React, { useState, useEffect } from 'react';
import { Contact, AppSection } from './types';
import VoiceController from './components/VoiceController';
import CompactDashboard from './components/CompactDashboard';
import ImportScreen from './components/ImportScreen';

const App: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSection, setCurrentSection] = useState<AppSection>(AppSection.DIALER);

  useEffect(() => {
    const saved = localStorage.getItem('drivedialer_contacts');
    if (saved) {
      const parsed = JSON.parse(saved);
      setContacts(parsed);
      // Vind de eerste die nog niet gebeld is
      const firstPending = parsed.findIndex((c: Contact) => c.status === 'pending');
      if (firstPending !== -1) setCurrentIndex(firstPending);
    }
  }, []);

  const handleDataUpdate = (newContacts: Contact[]) => {
    setContacts(newContacts);
    setCurrentIndex(0);
    localStorage.setItem('drivedialer_contacts', JSON.stringify(newContacts));
    setCurrentSection(AppSection.DIALER);
  };

  const markAsCalled = (id: string) => {
    const updated = contacts.map(c => c.id === id ? { ...c, status: 'called' as const } : c);
    setContacts(updated);
    localStorage.setItem('drivedialer_contacts', JSON.stringify(updated));
    
    // We laten de VoiceController bepalen wanneer we naar de volgende gaan, 
    // maar we zorgen hier voor de data-integriteit.
    if (currentIndex < contacts.length - 1) {
        setCurrentIndex(v => v + 1);
    }
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col p-6 safe-top safe-bottom overflow-hidden">
      <CompactDashboard 
        onSettingsClick={() => setCurrentSection(s => s === AppSection.SETTINGS ? AppSection.DIALER : AppSection.SETTINGS)} 
        isSettingsOpen={currentSection === AppSection.SETTINGS}
      />

      <div className="flex-1 flex flex-col mt-4">
        {currentSection === AppSection.SETTINGS ? (
          <ImportScreen onDataLoaded={handleDataUpdate} onBack={() => setCurrentSection(AppSection.DIALER)} />
        ) : contacts.length > 0 && currentIndex < contacts.length ? (
          <VoiceController 
            key={currentIndex} // Re-mount controller bij index change voor schone sessies indien nodig
            contacts={contacts} 
            currentIndex={currentIndex}
            setCurrentIndex={setCurrentIndex}
            onCallComplete={markAsCalled}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-12 animate-in fade-in duration-1000">
            <div className="space-y-4">
              <h2 className="text-sm font-black uppercase text-white/20 tracking-[0.5em]">Lijst Voltooid</h2>
              <p className="text-blue-500/40 text-[10px] font-bold uppercase tracking-widest">Alle contacten zijn verwerkt</p>
            </div>
            <button 
              onClick={() => setCurrentSection(AppSection.SETTINGS)}
              className="bg-blue-600/10 border border-blue-500/20 text-blue-500 px-10 py-5 rounded-full font-black uppercase text-[10px] tracking-[0.3em] hover:bg-blue-600 hover:text-white transition-all shadow-2xl shadow-blue-900/20"
            >
              Nieuwe Lijst
            </button>
          </div>
        )}
      </div>

      <div className="pb-8 h-4"></div>
    </div>
  );
};

export default App;
