
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
        { id: '1', name: 'Sophie de Boer', subject: 'Afspraak bevestigen', phone: '+31612345678', status: 'pending' },
        { id: '2', name: 'Jan Jansen', subject: 'Offerte zonnepanelen', phone: '+31687654321', status: 'pending' }
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
    <div className="min-h-screen bg-black text-white font-sans selection:bg-blue-500/30 overflow-hidden">
      <div className="max-w-4xl mx-auto h-screen flex flex-col px-4 py-4 sm:py-6 overflow-hidden">
        
        <CompactDashboard 
          onSettingsClick={() => setCurrentSection(s => s === AppSection.SETTINGS ? AppSection.DIALER : AppSection.SETTINGS)} 
          isSettingsOpen={currentSection === AppSection.SETTINGS}
        />

        <div className="flex-1 overflow-y-auto mt-4 sm:mt-8 space-y-6 scrollbar-hide">
          {currentSection === AppSection.SETTINGS ? (
            <ImportScreen 
              onDataLoaded={handleDataUpdate} 
              onBack={() => setCurrentSection(AppSection.DIALER)} 
            />
          ) : (
            <div className="space-y-6 sm:space-y-10">
              <VoiceController 
                contacts={contacts} 
                currentIndex={currentIndex}
                setCurrentIndex={setCurrentIndex}
                onCallComplete={markAsCalled}
              />

              <div className="pt-4 border-t border-white/5 pb-10">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-[9px] font-black uppercase tracking-[0.5em] text-white/30">Wachtrij</h3>
                  <span className="text-[8px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full uppercase tracking-widest border border-blue-500/20">
                    {Math.max(0, contacts.length - (currentIndex + 1))} Resterend
                  </span>
                </div>
                <CompactList contacts={contacts} currentIndex={currentIndex} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
