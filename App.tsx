
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
        ) : contacts.length > 0 ? (
          <VoiceController 
            contacts={contacts} 
            currentIndex={currentIndex}
            setCurrentIndex={setCurrentIndex}
            onCallComplete={markAsCalled}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-12">
            <h2 className="text-sm font-black uppercase text-white/20 tracking-[0.5em]">Geen Lijst</h2>
            <button 
              onClick={() => setCurrentSection(AppSection.SETTINGS)}
              className="bg-blue-600 px-10 py-5 rounded-full font-black uppercase text-[10px] tracking-[0.3em]"
            >
              Importeer Spreadsheet
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
