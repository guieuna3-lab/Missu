import { router, useLocalSearchParams } from 'expo-router';
import type { Party } from '@/lib/activity/types';
import { goBack } from '@/lib/navigation';
import { AppointmentProposalScreen } from './AppointmentProposalScreen';
import { SuspiciousReportScreen } from './SuspiciousReportScreen';

// Thin route entries under /requests/[id]. The holder opens the same report screen with
// ?role=holder from 08-B.01 and 08-B.02-A.
function useRole(): Party {
  const { role } = useLocalSearchParams<{ role?: string }>();
  return role === 'holder' ? 'holder' : 'requester';
}

export function RequestProposeRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const role = useRole();
  const back = () => goBack({ pathname: '/requests/[id]', params: { id } });
  return <AppointmentProposalScreen requestId={id} role={role} onBack={back} onSent={back} />;
}

export function RequestReportRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const role = useRole();
  return (
    <SuspiciousReportScreen
      requestId={id}
      role={role}
      onBack={() => goBack({ pathname: '/requests/[id]', params: { id } })}
      onSubmitted={() => router.replace({ pathname: '/requests/[id]/reported', params: { id } })}
    />
  );
}
