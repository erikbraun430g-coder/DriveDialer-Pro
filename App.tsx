
import React, { useState, useEffect } from 'react';
import { Contact, AppSection } from './types';
import VoiceController from './components/VoiceController';
import CompactDashboard from './components/CompactDashboard';
import CompactList from './components/CompactList';
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
        { id: '2', name: 'Jan Jansen', relation: 'Solar Pro', subject: 'Offerte zonnepanelen', phone: '+31687654321', status: 'pending' }
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
    <div className="h-[100svh] bg-black text-white font-sans selection:bg-blue-500/30 overflow-hidden flex flex-col">
      <div className="max-w-4xl mx-auto w-full h-full flex flex-col px-4 pt-4 pb-4">
        
        <CompactDashboard 
          onSettingsClick={() => setCurrentSection(s => s === AppSection.SETTINGS ? AppSection.DIALER : AppSection.SETTINGS)} 
          isSettingsOpen={currentSection === AppSection.SETTINGS}
        />

        <div className="flex-1 overflow-hidden mt-6">
          {currentSection === AppSection.SETTINGS ? (
            <div className="h-full overflow-y-auto scrollbar-hide">
              <ImportScreen 
                onDataLoaded={handleDataUpdate} 
                onBack={() => setCurrentSection(AppSection.DIALER)} 
              />
            </div>
          ) : (
            <div className="flex flex-col h-full gap-6">
              <VoiceController 
                contacts={contacts} 
                currentIndex={currentIndex}
                setCurrentIndex={setCurrentIndex}
                onCallComplete={markAsCalled}
              />

              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-white/30">Wachtrij</h3>
                  <span className="text-[10px] font-bold text-blue-500">
                    {Math.max(0, contacts.length - (currentIndex + 1))} Resterend
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-hide">
                  <CompactList contacts={contacts} currentIndex={currentIndex} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
