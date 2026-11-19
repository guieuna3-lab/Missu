import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton } from './ActionButton';
import { ItemThumb } from './ItemThumb';
import { PhotoPager } from './PhotoPager';
import { displayPhotoUrls, loadItemPhotos } from '@/lib/itemPhotos';
import { colors, typography } from '@/constants/theme';

/** 회원·학교·경찰·포털기관이 같은 갱신/실패 처리를 사용합니다. */
function Gallery({
  id,
  name,
  category,
  photoUrls = [],
}: {
  id: string;
  name: string;
  category?: string;
  photoUrls?: string[];
}) {
  const signature = JSON.stringify(photoUrls);
  const [urls, setUrls] = useState(() => displayPhotoUrls(id, photoUrls));
  const [loading, setLoading] = useState(!photoUrls.length);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const renewed = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const run = ++generation.current;
    renewed.current = false;
    const supplied = displayPhotoUrls(id, JSON.parse(signature) as string[]);
    if (!supplied.length) {
      renewed.current = true;
      void loadItemPhotos(id)
        .then(
          (fresh) => {
            if (run === generation.current) setUrls(fresh);
          },
          () => {
            if (run === generation.current) setFailed(true);
          },
        )
        .finally(() => {
          if (run === generation.current) setLoading(false);
        });
    }
    return () => {
      generation.current = run + 1;
    };
  }, [id, signature]);
  function refresh() {
    if (loading) return;
    const run = generation.current;
    renewed.current = true;
    setLoading(true);
    setFailed(false);
    void loadItemPhotos(id, true)
      .then(
        (fresh) => {
          if (run !== generation.current) return;
          setUrls(fresh);
          setVersion((v) => v + 1);
        },
        () => {
          if (run === generation.current) setFailed(true);
        },
      )
      .finally(() => {
        if (run === generation.current) setLoading(false);
      });
  }
  function photoError() {
    setFailed(true);
    if (!renewed.current) refresh();
  }
  return (
    <View>
      {urls.length ? (
        <PhotoPager
          key={`${id}:${version}`}
          uris={urls}
          label={name}
          category={category}
          onError={photoError}
        />
      ) : (
        <View style={styles.empty}>
          <ItemThumb name={name} category={category} size={56} />
          <Text style={styles.caption}>
            {loading
              ? '사진을 확인하고 있어요.'
              : failed
                ? '사진을 불러오지 못했어요.'
                : '등록된 사진이 없어요.'}
          </Text>
        </View>
      )}
      {loading && urls.length > 0 && (
        <Text style={styles.caption}>사진을 다시 확인하고 있어요.</Text>
      )}
      {failed && !loading && (
        <ActionButton
          label="사진 다시 불러오기"
          variant="outline"
          style={styles.retry}
          onPress={refresh}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  empty: { padding: 20, alignItems: 'center', gap: 10, backgroundColor: colors.white },
  caption: { ...typography.body, color: colors.muted, textAlign: 'center', padding: 8 },
  retry: { marginHorizontal: 16, marginBottom: 12 },
});

export function ItemPhotoGallery(props: Parameters<typeof Gallery>[0]) {
  return <Gallery key={props.id + JSON.stringify(props.photoUrls ?? [])} {...props} />;
}
