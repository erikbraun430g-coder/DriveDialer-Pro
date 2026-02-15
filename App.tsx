
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
    <div className="min-h-screen bg-black text-white font-sans selection:bg-blue-500/30">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-10 space-y-6 sm:space-y-12">
        
        <CompactDashboard 
          onSettingsClick={() => setCurrentSection(s => s === AppSection.SETTINGS ? AppSection.DIALER : AppSection.SETTINGS)} 
          isSettingsOpen={currentSection === AppSection.SETTINGS}
        />

        {currentSection === AppSection.SETTINGS ? (
          <ImportScreen 
            onDataLoaded={handleDataUpdate} 
            onBack={() => setCurrentSection(AppSection.DIALER)} 
          />
        ) : (
          <div className="space-y-8 sm:space-y-16">
            <VoiceController 
              contacts={contacts} 
              currentIndex={currentIndex}
              setCurrentIndex={setCurrentIndex}
              onCallComplete={markAsCalled}
            />

            <div className="pt-6 sm:pt-10 border-t border-white/5">
              <div className="flex justify-between items-center mb-4 sm:mb-8">
                <h3 className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.5em] text-white/30">Wachtrij</h3>
                <div className="h-px flex-1 mx-4 sm:mx-6 bg-white/5"></div>
                <span className="text-[9px] sm:text-[10px] font-bold text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full uppercase tracking-widest border border-blue-500/20">
                  {Math.max(0, contacts.length - (currentIndex + 1))} Resterend
                </span>
              </div>
              <CompactList contacts={contacts} currentIndex={currentIndex} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
