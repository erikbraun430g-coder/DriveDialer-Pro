
import React from 'react';

const Dashboard: React.FC = () => {
  return (
    <div className="space-y-8 animate-slideUp">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Status Overzicht</h2>
          <p className="text-slate-400 font-medium">Alles ziet er goed uit voor je volgende rit.</p>
        </div>
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100">
          <div className="px-4 py-2 bg-green-50 text-green-600 rounded-xl text-xs font-bold uppercase tracking-wider">Verbonden</div>
        </div>
      </header>

      {/* Hero Car Card */}
      <div className="relative bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm overflow-hidden min-h-[240px]">
         <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Actieradius</p>
                <p className="text-6xl font-black text-slate-900">412 <span className="text-2xl text-slate-400 font-normal">km</span></p>
              </div>
              <div className="flex gap-4">
                <div className="bg-slate-50 px-4 py-2 rounded-xl">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Accu</p>
                  <p className="font-bold text-blue-600">84%</p>
                </div>
                <div className="bg-slate-50 px-4 py-2 rounded-xl">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Bandendruk</p>
                  <p className="font-bold text-green-500">Optimaal</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center">
               <div className="p-6 bg-blue-50 border border-blue-100 rounded-3xl">
                  <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
                    <span className="text-xl">💡</span> AI Tip
                  </h3>
                  <p className="text-sm text-blue-700 leading-relaxed">
                    Je hebt morgen een lange rit gepland. Laad de auto vanavond op tot 100% voor maximale efficiëntie.
                  </p>
               </div>
            </div>
         </div>
      </div>

      {/* Grid Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow cursor-pointer group">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform">🔍</div>
          <h4 className="font-bold text-lg mb-1">Scan Dashboard</h4>
          <p className="text-sm text-slate-400">Identificeer waarschuwingslampjes met AI.</p>
        </div>
        
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow cursor-pointer group">
          <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform">🛣️</div>
          <h4 className="font-bold text-lg mb-1">Laatste Rit</h4>
          <p className="text-sm text-slate-400">12.5 km • 94% Eco Score</p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow cursor-pointer group">
          <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform">🤖</div>
          <h4 className="font-bold text-lg mb-1">Vraag de Expert</h4>
          <p className="text-sm text-slate-400">Direct advies bij technische vragen.</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
