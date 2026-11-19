import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { ItemThumb } from './ItemThumb';
import { usePhotoVisibility } from './usePhotoVisibility';
import { displayPhotoUrls, loadItemPhotos, thumbnailPhotoUrl } from '@/lib/itemPhotos';

function Thumb({
  id,
  name,
  category,
  photoUrls = [],
  size,
}: {
  id: string;
  name: string;
  category?: string;
  photoUrls?: string[];
  size?: number;
}) {
  const signature = JSON.stringify(photoUrls);
  const { ref, ready } = usePhotoVisibility();
  const [resolved, setResolved] = useState<string[]>();
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const generation = useRef(0);
  const renewed = useRef(false);
  useEffect(() => {
    if (!ready) return;
    alive.current = true;
    const run = ++generation.current;
    renewed.current = false;
    const supplied = JSON.parse(signature) as string[];
    if (!supplied.length) {
      renewed.current = true;
      void loadItemPhotos(id).then(
        (urls) => {
          if (alive.current && run === generation.current) setResolved(urls);
        },
        () => {},
      );
    }
    return () => {
      alive.current = false;
      generation.current = run + 1;
    };
  }, [id, signature, ready]);
  const urls = resolved ?? displayPhotoUrls(id, photoUrls);
  function failed() {
    if (index + 1 < urls.length) {
      setIndex(index + 1);
      return;
    }
    if (renewed.current) return;
    renewed.current = true;
    const run = generation.current;
    void loadItemPhotos(id, true).then(
      (fresh) => {
        if (!alive.current || run !== generation.current) return;
        setResolved(fresh);
        setIndex(0);
        setAttempt((n) => n + 1);
      },
      () => {},
    );
  }
  return (
    <View ref={ref} style={{ width: size ?? 46, height: size ?? 46, flexShrink: 0 }}>
      <ItemThumb
        key={`${id}:${index}:${attempt}:${urls[index] ?? ''}`}
        name={name}
        category={category}
        photoUrl={ready && urls[index] ? thumbnailPhotoUrl(urls[index]) : undefined}
        size={size}
        onPhotoError={failed}
      />
    </View>
  );
}

export function ItemPhotoThumb(props: Parameters<typeof Thumb>[0]) {
  return <Thumb key={props.id + JSON.stringify(props.photoUrls ?? [])} {...props} />;
}
