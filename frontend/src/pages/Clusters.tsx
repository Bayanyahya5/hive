import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Network, Users, Tag, MessageSquare } from 'lucide-react';

export default function Clusters() {
  const [clusters, setClusters] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClusterAnalysis();
  
    const channel = supabase
      .channel('clusters-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clusters' }, () => {
        fetchClusterAnalysis();
      })
      .subscribe();
  
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchClusterAnalysis = async () => {
    setLoading(true);
  
    const { data: clusterRows, error: clusterError } = await supabase
      .from('clusters')
      .select('id, label, top_keywords, sample_posts, created_at')
      .order('created_at', { ascending: true });
  
    const { data: classData } = await supabase
      .from('classifications')
      .select('profile_id, party, cluster_id')
      .not('cluster_id', 'is', null);
  
    if (clusterError) {
      console.error('Cluster fetch error:', clusterError);
      setLoading(false);
      return;
    }
  
    if (!clusterRows || clusterRows.length === 0) {
      setClusters({});
      setLoading(false);
      return;
    }
  
    const grouped: Record<string, any> = {};
  
    for (const cluster of clusterRows) {
      const members = (classData || []).filter(c => c.cluster_id === cluster.id);
  
      const parties: Record<string, number> = {};
      members.forEach(m => {
        const party = m.party || 'unclear';
        parties[party] = (parties[party] || 0) + 1;
      });
  
      const dominantParty = Object.keys(parties).length > 0
        ? Object.keys(parties).reduce((a, b) => (parties[a] > parties[b] ? a : b))
        : 'unclear';
  
      grouped[cluster.id] = {
        id: cluster.id,
        label: cluster.label,
        keywords: cluster.top_keywords || [],
        samplePosts: cluster.sample_posts || [],
        memberCount: members.length,
        dominantParty,
      };
    }
  
    setClusters(grouped);
    setLoading(false);
  };

  // Consistent color dictionary matching Overview and Profiles pages
  const PARTY_COLORS: Record<string, string> = {
    "Ra'am": 'border-[#00C49F] text-[#00C49F] bg-[#00C49F]/10',
    "Hadash": 'border-[#FF8042] text-[#FF8042] bg-[#FF8042]/10',
    "Balad": 'border-[#FFBB28] text-[#FFBB28] bg-[#FFBB28]/10',
    "Ta'al": 'border-[#8884d8] text-[#8884d8] bg-[#8884d8]/10',
    "Jewish-sector party": 'border-[#0088FE] text-[#0088FE] bg-[#0088FE]/10',
    "unclear": 'border-[#9ca3af] text-[#9ca3af] bg-[#9ca3af]/10',
    "Unclassified": 'border-gray-300 text-gray-500 bg-gray-100'
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Network className="text-blue-600" />
            Cluster Analysis
          </h2>
          <p className="text-gray-500 mt-1">AI-generated voter similarity groupings and linguistic trends</p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white p-10 rounded-xl shadow-sm border border-gray-100 text-center text-gray-500">
          Running linguistic grouping analysis...
        </div>
      ) : Object.keys(clusters).length === 0 ? (
        <div className="bg-white p-10 rounded-xl shadow-sm border border-gray-100 text-center text-gray-500">
          No cluster data found. Have you run the AI Classification pipeline yet?
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.values(clusters).map((cluster: any) => (
            <div key={cluster.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col hover:shadow-md transition-shadow">
              
              <div className="bg-gray-50 p-4 border-b border-gray-100 flex justify-between items-center">
                <h3 className="font-bold text-gray-800 text-lg">{cluster.label || `Cluster ${cluster.id.slice(0, 8)}`}</h3>
                <span className="flex items-center gap-1.5 text-blue-700 text-xs font-bold bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full shadow-sm">
                  <Users size={14} /> Size: {cluster.memberCount || 0}
                </span>
              </div>
              
              <div className="p-5 flex-1 flex flex-col space-y-5">
                {/* Dominant Party */}
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-1.5">Dominant Alignment</p>
                  <span className={`px-2.5 py-0.5 border rounded text-xs font-semibold inline-block ${PARTY_COLORS[cluster.dominantParty] || 'border-blue-200 text-blue-700 bg-blue-50'}`}>
                    {cluster.dominantParty}
                  </span>
                </div>
                
                {/* Top Keywords */}
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-2 flex items-center gap-1">
                    <Tag size={10} /> Top Keywords
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(cluster.keywords || []).map((word: string, idx: number) => (
                      <span key={idx} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md font-mono">
                        #{word}
                      </span>
                    ))}
                  </div>
                </div>
                
                {/* Sample Posts */}
                <div className="flex-1 flex flex-col">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-2 flex items-center gap-1">
                    <MessageSquare size={10} /> Sample Posts
                  </p>
                  <div className="space-y-2 flex-1 overflow-y-auto max-h-48 pr-1">
                    {(cluster.samplePosts || []).slice(0, 2).map((post: string, idx: number) => {
                      // Final safety check to ensure string methods don't crash
                      const safePost = typeof post === 'string' ? post : '';
                      const displayPost = safePost.length > 120 ? safePost.substring(0, 120) + '...' : safePost;
                      
                      return (
                        <div key={idx} className="bg-blue-50/40 border border-blue-50 p-3 rounded-lg text-xs text-gray-600 italic leading-relaxed">
                          "{displayPost}"
                        </div>
                      );
                    })}
                    {(cluster.samplePosts || []).length === 0 && (
                      <p className="text-xs text-gray-400 italic">No historical text entries matched this cluster group.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}