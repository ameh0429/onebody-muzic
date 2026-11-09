import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60000, gcTime: 300000, retry: false, refetchOnWindowFocus: false } } });
export function useApi<T>(path: string) { return useQuery({ queryKey: [path], queryFn: async ({ signal }) => (await api.get<T>(path, { signal })).data }); }
export function refresh() { return queryClient.invalidateQueries(); }
