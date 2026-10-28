import {
  faCamera,
  faEnvelope,
  faGlobe,
  faLink,
  faUsers,
  faVideo,
} from '@fortawesome/duotone-regular-svg-icons';

export const footerIcons = {
  camera: faCamera,
  email: faEnvelope,
  link: faLink,
  social: faUsers,
  video: faVideo,
  website: faGlobe,
};
export const footerIconOptions = [
  { label: 'Website', value: 'website' },
  { label: 'Email', value: 'email' },
  { label: 'Community', value: 'social' },
  { label: 'Photos', value: 'camera' },
  { label: 'Video', value: 'video' },
  { label: 'Link', value: 'link' },
] as const;
