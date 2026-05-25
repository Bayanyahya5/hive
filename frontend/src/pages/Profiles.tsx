import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Search, Filter, X, FileText, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, UserCircle2 } from 'lucide-react';

export default function Profiles() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering state
  const [searchTerm, setSearchTerm] = useState('');
  const [partyFilter, setPartyFilter] = useState('All');
  const [clusterFilter, setClusterFilter] = useState('All');
  const [consentFilter, setConsentFilter] = useState('All');
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  
  // Modal state
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);

  useEffect(() => {
    fetchProfiles();
  }, []);

  // Reset to page 1 whenever a filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, partyFilter, clusterFilter, consentFilter]);

  const fetchProfiles = async () => {
    setLoading(true);
    const { data: profilesData, error: profilesError } = await supabase.from('profiles').select('id, name, city, age_range');
    if (profilesError) {
      alert("Error fetching profiles: " + profilesError.message);
      setLoading(false);
      return;
    }

    const { data: classData } = await supabase.from('classifications').select('profile_id, party, confidence, cluster_id');
    const { data: consentData } = await supabase.from('consent_log').select('profile_id, scope, timestamp');

    const mergedProfiles = profilesData?.map(profile => {
      const userClass = classData?.find(c => c.profile_id === profile.id);
      const userConsents = (consentData || [])
        .filter(c => c.profile_id === profile.id)
        .sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeB - timeA;
        });

      const latestConsent = userConsents[0];

      return {
        ...profile,
        classifications: userClass ? [userClass] : [],
        consent_log: latestConsent ? [latestConsent] : []
      };
    }) || [];

    setProfiles(mergedProfiles);
    setLoading(false);
  };

  const openProfileModal = async (profile: any) => {
    setSelectedProfile(profile);
    setLoadingPosts(true);
    const { data } = await supabase
      .from('posts')
      .select('content, created_at')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false });
    setUserPosts(data || []);
    setLoadingPosts(false);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // --- DYNAMIC DROPDOWN GENERATORS ---
  const uniqueClusters = Array.from(new Set(
    profiles.map(p => p.classifications?.[0]?.cluster_id ? String(p.classifications[0].cluster_id) : 'Unassigned')
  ))
  .filter(c => c !== 'Unassigned')
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const uniqueConsents = Array.from(new Set(
    profiles.map(p => p.consent_log?.[0]?.scope || 'Missing')
  )).sort();

  // --- 1. FILTER ---
  const filteredProfiles = profiles.filter(p => {
    const party = p.classifications?.[0]?.party || 'Unclassified';
    const cluster = p.classifications?.[0]?.cluster_id ? String(p.classifications[0].cluster_id) : 'Unassigned';
    const consent = p.consent_log?.[0]?.scope || 'Missing';
    const safeName = p.name || '';
    const safeCity = p.city || '';
    
    const search = searchTerm.toLowerCase().trim();
    const matchesSearch = safeName.toLowerCase().includes(search) || safeCity.toLowerCase().includes(search);
    const matchesParty = partyFilter === 'All' || party === partyFilter;
    const matchesCluster = clusterFilter === 'All' || cluster === clusterFilter;
    const matchesConsent = consentFilter === 'All' || consent === consentFilter;
    
    return matchesSearch && matchesParty && matchesCluster && matchesConsent;
  });

  // --- 2. SORT ---
  const sortedProfiles = [...filteredProfiles].sort((a, b) => {
    let valA = '';
    let valB = '';

    if (sortConfig.key === 'party') {
      valA = a.classifications?.[0]?.party || 'Unclassified';
      valB = b.classifications?.[0]?.party || 'Unclassified';
    } else if (sortConfig.key === 'consent') {
      valA = a.consent_log?.[0]?.scope || 'Missing';
      valB = b.consent_log?.[0]?.scope || 'Missing';
    } else {
      valA = String(a[sortConfig.key] || '');
      valB = String(b[sortConfig.key] || '');
    }

    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  // --- 3. PAGINATE ---
  const totalPages = Math.ceil(sortedProfiles.length / ITEMS_PER_PAGE);
  const paginatedProfiles = sortedProfiles.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // --- UI HELPERS ---
  const getPartyColor = (party: string) => {
    switch (party) {
      case "Ra'am": return "bg-[#00C49F]/15 text-[#00C49F] border-[#00C49F]/30";
      case "Hadash": return "bg-[#FF8042]/15 text-[#FF8042] border-[#FF8042]/30";
      case "Balad": return "bg-[#FFBB28]/15 text-[#FFBB28] border-[#FFBB28]/30";
      case "Ta'al": return "bg-[#8884d8]/15 text-[#8884d8] border-[#8884d8]/30";
      case "Unclassified": return "bg-gray-100 text-gray-500 border-gray-200";
      case "Jewish-sector party": return "bg-[#0088FE]/15 text-[#0088FE] border-[#0088FE]/30";
      case "unclear": return "bg-gray-100 text-gray-500 border-gray-200";
      default: return "bg-[#0088FE]/15 text-[#0088FE] border-[#0088FE]/30";
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig.key !== columnKey) return <ChevronUp size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />;
    return sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-600" /> : <ChevronDown size={14} className="text-blue-600" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Profiles Database</h2>
          <p className="text-gray-500 mt-1">Manage and filter user data</p>
        </div>
      </div>
        
      {/* Search & Filter Controls Panel */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Search name or city..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        
        <div className="flex gap-3">
          {/* Party Filter */}
          <div className="relative w-44">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <select 
              value={partyFilter}
              onChange={(e) => setPartyFilter(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white cursor-pointer"
            >
              <option value="All">All Parties</option>
              <option value="Unclassified">Unclassified</option>
              <option value="Ra'am">Ra'am</option>
              <option value="Hadash">Hadash</option>
              <option value="Balad">Balad</option>
              <option value="Ta'al">Ta'al</option>
              <option value="Jewish-sector party">Jewish-sector party</option>
              <option value="unclear">unclear</option>
            </select>
          </div>

          {/* DYNAMIC Cluster Filter */}
          <div className="relative w-44">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <select 
              value={clusterFilter}
              onChange={(e) => setClusterFilter(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white cursor-pointer"
            >
              <option value="All">All Clusters</option>
              <option value="Unassigned">Unassigned</option>
              {uniqueClusters.map(cluster => (
                <option key={cluster} value={cluster}>Cluster {cluster}</option>
              ))}
            </select>
          </div>

          {/* DYNAMIC Consent Filter */}
          <div className="relative w-44">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <select 
              value={consentFilter}
              onChange={(e) => setConsentFilter(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white cursor-pointer"
            >
              <option value="All">All Consents</option>
              {uniqueConsents.map(consent => <option key={consent} value={consent}>{consent}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-10 text-center text-gray-500">Loading database...</div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['name', 'city', 'age_range', 'party', 'consent'].map((key) => (
                    <th 
                      key={key}
                      onClick={() => handleSort(key)}
                      className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors group select-none"
                    >
                      <div className="flex items-center gap-2">
                        {key === 'city' ? 'City' : 
                         key === 'age_range' ? 'Age Range' : 
                         key === 'party' ? 'AI Classification' : 
                         key === 'consent' ? 'Consent Scope' : 'Name'}
                        <SortIcon columnKey={key} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedProfiles.length > 0 ? paginatedProfiles.map((profile) => {
                  const party = profile.classifications?.[0]?.party || 'Unclassified';
                  const confidence = profile.classifications?.[0]?.confidence;
                  const consent = profile.consent_log?.[0]?.scope || 'Missing';

                  return (
                    <tr 
                      key={profile.id} 
                      onClick={() => openProfileModal(profile)}
                      className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <td className="p-4 font-medium text-gray-900 flex items-center gap-3">
                        <div className="bg-gray-100 p-2 rounded-full text-gray-400">
                          <UserCircle2 size={16} />
                        </div>
                        {profile.name}
                      </td>
                      <td className="p-4 text-gray-600">{profile.city}</td>
                      <td className="p-4 text-gray-600">{profile.age_range}</td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getPartyColor(party)}`}>
                          {party} {confidence && `(${(confidence * 100).toFixed(0)}%)`}
                        </span>
                      </td>
                      <td className="p-4 text-gray-500 text-sm">{consent}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-gray-500">No profiles match your search criteria.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        {!loading && totalPages > 1 && (
          <div className="bg-gray-50 p-4 border-t border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, sortedProfiles.length)} of {sortedProfiles.length} profiles
            </span>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-white transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm font-medium text-gray-700 px-2">
                Page {currentPage} of {totalPages}
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-white transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Enhanced Detail Modal */}
      {selectedProfile && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-100 flex justify-between items-start bg-gray-50">
              <div className="flex items-center gap-4">
                <div className="bg-blue-100 p-4 rounded-full text-blue-600">
                  <UserCircle2 size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{selectedProfile.name}</h3>
                  <p className="text-gray-500 font-medium">{selectedProfile.city} • {selectedProfile.age_range}</p>
                </div>
              </div>
              <button onClick={() => setSelectedProfile(null)} className="p-2 bg-white hover:bg-gray-100 border border-gray-200 rounded-full text-gray-500 transition-colors shadow-sm">
                <X size={20} />
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 bg-white">
              <h4 className="text-xs text-gray-400 uppercase tracking-wider font-bold mb-3">AI Analysis Results</h4>
              <div className="mb-8 grid grid-cols-3 gap-4">
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <p className="text-xs text-gray-500 font-semibold mb-1">Classification</p>
                  <p className={`font-bold inline-block px-2 py-0.5 rounded text-sm border ${getPartyColor(selectedProfile.classifications?.[0]?.party || 'Unclassified')}`}>
                    {selectedProfile.classifications?.[0]?.party || 'Unclassified'}
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <p className="text-xs text-gray-500 font-semibold mb-1">Confidence</p>
                  <p className="font-bold text-gray-900 text-lg">
                    {selectedProfile.classifications?.[0]?.confidence 
                      ? `${(selectedProfile.classifications[0].confidence * 100).toFixed(1)}%` 
                      : 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <p className="text-xs text-gray-500 font-semibold mb-1">Cluster ID</p>
                  <p className="font-bold text-gray-900 text-lg">{selectedProfile.classifications?.[0]?.cluster_id || 'N/A'}</p>
                </div>
              </div>

              <h4 className="text-xs text-gray-400 uppercase tracking-wider font-bold mb-4 flex items-center gap-2">
                <FileText size={16} /> Synthetic Posts History
              </h4>
              
              <div className="space-y-4">
                {loadingPosts ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-16 bg-gray-100 rounded-xl w-full"></div>
                    <div className="h-16 bg-gray-100 rounded-xl w-3/4"></div>
                  </div>
                ) : userPosts.length > 0 ? (
                  userPosts.map((post, idx) => (
                    <div key={idx} className="bg-blue-50/50 p-5 rounded-2xl rounded-tl-sm border border-blue-100 text-gray-700 shadow-sm relative">
                       <p className="text-sm leading-relaxed">"{post.content}"</p>
                       <span className="absolute bottom-2 right-4 text-[10px] font-medium text-gray-400">
                         {new Date(post.created_at).toLocaleDateString()}
                       </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    No posts generated for this user yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}