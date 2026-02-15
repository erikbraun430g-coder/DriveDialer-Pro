
import React from 'react';

const Maintenance: React.FC = () => {
  const records = [
    { id: '1', date: 'Aug 15, 2023', type: 'Tire Rotation', cost: '$45.00', status: 'Completed' },
    { id: '2', date: 'May 10, 2023', type: 'Annual Service', cost: '$180.00', status: 'Completed' },
    { id: '3', date: 'Jan 22, 2023', type: 'Brake Inspection', cost: '$0.00', status: 'Completed' },
  ];

  return (
    <div className="space-y-8 animate-fadeIn">
      <header>
        <h2 className="text-3xl font-bold">Maintenance</h2>
        <p className="text-slate-400">Track your vehicle service history and upcoming needs.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Next Service Card */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
          </div>
          <div className="relative z-10">
            <span className="bg-blue-600/20 text-blue-400 text-[10px] font-bold uppercase px-2 py-1 rounded">Next Priority</span>
            <h3 className="text-4xl font-black mt-4">2,400 <span className="text-xl text-slate-500 font-normal">km</span></h3>
            <p className="text-slate-400 mt-2 font-medium">Until next Major Service</p>
            <div className="w-full bg-slate-800 h-2 rounded-full mt-6">
              <div className="bg-blue-500 h-2 rounded-full w-[75%] shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
            </div>
            <p className="text-xs text-slate-500 mt-3 text-right">Service due around January 2024</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl flex flex-col justify-center gap-4">
          <button className="w-full bg-slate-800 hover:bg-slate-700 p-4 rounded-xl flex items-center justify-between group transition-all">
            <div className="flex items-center gap-3 text-left">
              <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <p className="font-bold">Add New Record</p>
                <p className="text-xs text-slate-500">Log a manual service or part</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-slate-600 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
          
          <button className="w-full bg-slate-800 hover:bg-slate-700 p-4 rounded-xl flex items-center justify-between group transition-all">
            <div className="flex items-center gap-3 text-left">
              <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </div>
              <div>
                <p className="font-bold">Schedule Service</p>
                <p className="text-xs text-slate-500">Book at your nearest center</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-slate-600 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h3 className="font-bold text-lg">Past Service Records</h3>
        </div>
        <div className="divide-y divide-slate-800">
          {records.map(record => (
            <div key={record.id} className="p-6 flex items-center justify-between hover:bg-slate-800/20 transition-colors">
              <div>
                <p className="font-bold text-slate-100">{record.type}</p>
                <p className="text-sm text-slate-500">{record.date}</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{record.cost}</p>
                <span className="text-[10px] text-green-500 font-bold uppercase tracking-widest">{record.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Maintenance;
