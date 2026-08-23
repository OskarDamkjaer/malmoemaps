// Carlotta — Malmö Museer's image server, and the one thing you have to know
// about it.
//
// K-samsök hands out image URLs that do not work. `pres:src` comes through as
// `http://` with `+` where the spaces are:
//
//   http://carlotta.malmo.se/carlotta-mmus/web/image/zoom/3495933/CHA+001432.jpg
//
// Fetched exactly as given, that returns **HTTP 200 with an HTML error page** —
// seventy-odd kilobytes of markup with a .jpg on the end of the URL. Nothing in
// the status line says it failed. Over https with the spaces properly encoded,
// the same path returns the real plate, and they are large: 3750 × 3732 at
// 1.7 MB in one sample.
//
// So there are two rules, and both matter: rewrite the URL before fetching, and
// check the content type after, because a 200 is not evidence here.
export function imageUrl(src) {
  const url = new URL(src.replace(/^http:/, 'https:'));
  url.pathname = url.pathname
    .split('/')
    .map((s) => encodeURIComponent(decodeURIComponent(s.replace(/\+/g, ' '))))
    .join('/');
  return url.toString();
}
