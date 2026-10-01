-- Videos posted before chat could play them were stored as downloads ('other'): mark them by name so they play.
UPDATE "ChannelFile" SET "kind" = 'video', "mime" = 'video/mp4'
WHERE "kind" = 'other' AND (lower("name") LIKE '%.mp4' OR lower("name") LIKE '%.m4v');
UPDATE "ChannelFile" SET "kind" = 'video', "mime" = 'video/quicktime'
WHERE "kind" = 'other' AND lower("name") LIKE '%.mov';
UPDATE "ChannelFile" SET "kind" = 'video', "mime" = 'video/webm'
WHERE "kind" = 'other' AND lower("name") LIKE '%.webm';
