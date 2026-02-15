
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
    const savedContacts = localStorage.getItem('drivedialer_contacts');
    if (savedContacts) {
      setContacts(JSON.parse(savedContacts));
    } else {
      const defaultContacts: Contact[] = [
        { id: '1', name: 'Sophie de Boer', relation: 'De Boer Advies', subject: 'Afspraak bevestigen', phone: '+31612345678', status: 'pending' },
        { id: '2', name: 'Jan Jansen', relation: 'Solar Pro', subject: 'Offerte opvolgen', phone: '+31687654321', status: 'pending' }
      ];
      setContacts(defaultContacts);
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
  };

  return (
    <div className="h-[100svh] bg-black text-white overflow-hidden flex flex-col font-sans select-none">
      <div className="max-w-2xl mx-auto w-full h-full flex flex-col p-6">
        
        <CompactDashboard 
          onSettingsClick={() => setCurrentSection(s => s === AppSection.SETTINGS ? AppSection.DIALER : AppSection.SETTINGS)} 
          isSettingsOpen={currentSection === AppSection.SETTINGS}
        />

        <div className="flex-1 mt-6">
          {currentSection === AppSection.SETTINGS ? (
            <div className="h-full overflow-y-auto scrollbar-hide">
              <ImportScreen 
                onDataLoaded={handleDataUpdate} 
                onBack={() => setCurrentSection(AppSection.DIALER)} 
              />
            </div>
          ) : (
            <div className="h-full flex flex-col">
              {contacts.length > 0 && currentIndex < contacts.length ? (
                <VoiceController 
                  contacts={contacts} 
                  currentIndex={currentIndex}
                  setCurrentIndex={setCurrentIndex}
                  onCallComplete={markAsCalled}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8">
                  <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center text-4xl mb-4">
                    🏁
                  </div>
                  <h2 className="text-4xl font-black uppercase tracking-tighter">Lijst Voltooid</h2>
                  <button 
                    onClick={() => {
                        setCurrentIndex(0);
                        setCurrentSection(AppSection.SETTINGS);
                    }}
                    className="bg-blue-600 px-12 py-6 rounded-[32px] font-black uppercase tracking-widest shadow-2xl shadow-blue-600/20 active:scale-95 transition-all"
                  >
                    Nieuwe Lijst
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Progress indicator */}
        {currentSection === AppSection.DIALER && contacts.length > 0 && (
          <div className="pt-6 pb-2 border-t border-white/5">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em]">
                Voortgang: {currentIndex + 1} / {contacts.length}
              </span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 transition-all duration-500 ease-out"
                style={{ width: `${((currentIndex + 1) / contacts.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
