-- One-time: migrate description copy from removed index.html hardcoded cards
-- (Basic Coffee Bar + Premium Coffee Bar). Safe to re-run — overwrites descriptions
-- for matching product names only.

UPDATE products SET
  description_en = 'Cold brew, ready to serve at your event. We send the coffee and sugar syrup — you handle the rest your way. A simple, affordable way to bring premium cold brew to any occasion.',
  description_he = 'קולד ברו, מוכן להגשה באירוע שלך. אנחנו שולחים את הקפה וסירופ הסוכר — השאר בידיים שלך. דרך פשוטה ומשתלמת להביא קולד ברו פרימיום לכל אירוע.',
  is_coffee_bar = true
WHERE lower(trim(name_en)) = 'basic coffee bar';

UPDATE products SET
  description_en = 'Open the box and you''re ready. Dispenser, cold brew, milk, cups, straws, and three syrups — caramel, vanilla & sugar — all packed and included. Pour the coffee into the dispenser and start serving. That''s genuinely all it takes.',
  description_he = 'פתח את הקופסה ואתה מוכן. מתקן, קולד ברו, חלב, כוסות, קשיות ושלושה סירופים — קרמל, וניל וסוכר — הכל ארוז וכלול. שפוך את הקפה למתקן והתחל להגיש. זה באמת כל מה שצריך.',
  is_coffee_bar = true
WHERE lower(trim(name_en)) = 'premium coffee bar';
