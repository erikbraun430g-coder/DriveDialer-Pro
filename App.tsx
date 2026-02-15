
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
    if (saved) setContacts(JSON.parse(saved));
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
        ) : contacts.length > 0 && currentIndex < contacts.length ? (
          <VoiceController 
            contacts={contacts} 
            currentIndex={currentIndex}
            setCurrentIndex={setCurrentIndex}
            onCallComplete={markAsCalled}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8">
            <h2 className="text-xl font-bold uppercase text-white/20 tracking-widest">Lijst Leeg</h2>
            <button 
              onClick={() => setCurrentSection(AppSection.SETTINGS)}
              className="bg-blue-600 px-8 py-4 rounded-2xl font-bold uppercase text-sm"
            >
              Importeer Contacten
            </button>
          </div>
        )}
      </div>

      {currentSection === AppSection.DIALER && contacts.length > 0 && (
        <div className="pb-8 text-center">
            <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.3em]">
                Contact {currentIndex + 1} van {contacts.length}
            </p>
        </div>
      )}
    </div>
  );
};

export default App;
