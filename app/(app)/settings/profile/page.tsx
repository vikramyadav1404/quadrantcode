import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { getProfile } from '@/server/services/profile';
import { requireCurrentUser } from '@/server/services/auth/session';
import { getServerEnv } from '@/server/env';
import { isStorageConfigured } from '@/server/services/storage';
import { ProfileForm } from './ProfileForm';

export default async function ProfileSettingsPage() {
  const user = await requireCurrentUser();
  const profile = await getProfile(getDb(), user.id);

  return (
    <>
      <PageHeader
        title="Profile"
        description="How you appear in Quadrantcode. Only what you choose is ever public."
      />
      <ProfileForm
        avatarEnabled={isStorageConfigured(getServerEnv())}
        appearance={profile.appearance}
        initial={{
          displayName: profile.displayName ?? '',
          bio: profile.bio ?? '',
          targetRole: profile.targetRole,
          timezone: profile.timezone,
          publicProfileEnabled: profile.publicProfileEnabled,
          avatarUrl: profile.avatarUrl,
        }}
      />
    </>
  );
}
