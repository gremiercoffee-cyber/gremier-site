-- Start a separate balance without moving or changing any Classic stock.
INSERT INTO public.concentrate(type, liters) VALUES ('unfiltered', 0) ON CONFLICT (type) DO NOTHING;
