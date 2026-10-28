# Third-party notices

`vendor/businessmode-sdk-0.1.0-preview.1.tgz` contains the reviewed BusinessMode
SDK preview under its included ISC license. The demo code is MIT-licensed.

This archive was packed from SDK source at commit
`e7c4e0afe583e37dab7196846ccfc80922430a4e` (merged into staging in PR #42).
It replaces the earlier preview.0 archive and adds credential-origin checks,
redirect rejection and uncached authenticated requests. It is included while npm
publication is pending; no private workspace dependency is needed.

Archive SHA-256: `a54def2ea928ec46e203cc87e821727c5f0e4d5973ab09b03538801d6ce0ee08`.
`package-lock.json` also records the SHA-512 integrity digest.

After the matching version is published, replace this local archive dependency
with the exact npm version, remove the archive and repeat the integration checks.
Other dependencies retain their respective licenses in their distributed packages.
