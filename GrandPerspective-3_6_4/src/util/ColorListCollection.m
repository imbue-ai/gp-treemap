/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "ColorListCollection.h"

#import "PreferencesPanelControl.h"

NSString* fallbackColorListKey = @"Fallback";
NSString* fallbackColorListName = @"Fallback";

static NSString*  hexChars = @"0123456789ABCDEF";

float valueOfHexPair(NSString* hexString) {
  int  val = 0;
  int  i;
  for (i = 0; i < [hexString length]; i++) {
    val = val * 16;
    NSRange  r = [hexChars rangeOfString: [hexString substringWithRange: NSMakeRange(i, 1)]
                                 options: NSCaseInsensitiveSearch];
    val += r.location;
  }

  return (val / 255.0);
}

NSColor* colorForHexString(NSString* hexColor) {
  float  r = valueOfHexPair([hexColor substringWithRange: NSMakeRange(0, 2)]);
  float  g = valueOfHexPair([hexColor substringWithRange: NSMakeRange(2, 2)]);
  float  b = valueOfHexPair([hexColor substringWithRange: NSMakeRange(4, 2)]);

  return [NSColor colorWithDeviceRed:r green:g blue:b alpha:0];
}

NSColorList* createPalette(NSString *name, NSArray *colors) {
  NSColorList  *colorList = [[[NSColorList alloc] initWithName: name] autorelease];

  int count = 0;
  for (id colorString in colors) {
    [colorList insertColor: colorForHexString(colorString) key: colorString atIndex: count++];
  }

  return colorList;
}

NSColorList* createFallbackPalette(void) {
  // Hardcoded CoffeeBeans palette
  NSArray  *colors = @[@"CC3333", @"CC9933", @"FFCC66", @"CC6633", @"CC6666", @"993300", @"666600"];

  return createPalette(fallbackColorListName, colors);
}

#ifdef ENABLE_PALETTE_GRANDPERSPECTIVE
NSColorList* createGrandPerspectivePalette(void) {
  // Hardcoded "GrandPerspective" palette
  NSArray  *colors = @[@"35B7DA", @"61D7D7", @"679DB4", @"538CA7"];

  return createPalette(colors);
}
#endif

@interface ColorListCollection (PrivateMethods)

@property (nonatomic, readonly) bool isEmpty;

@end

@implementation ColorListCollection

+ (ColorListCollection *)defaultColorListCollection {
  static ColorListCollection  *defaultColorListCollectionInstance = nil;
  static dispatch_once_t  onceToken;

  dispatch_once(&onceToken, ^{
    ColorListCollection  *instance = [[[ColorListCollection alloc] init] autorelease];
    
    NSBundle  *bundle = NSBundle.mainBundle;
    NSArray  *colorListPaths = [bundle pathsForResourcesOfType: @".clr" inDirectory: @"Palettes"];
    for (NSString *path in [colorListPaths objectEnumerator]) {
      NSString  *name = path.lastPathComponent.stringByDeletingPathExtension;

      NSColorList  *colorList = [[[NSColorList alloc] initWithName: name
                                                          fromFile: path] autorelease];
      if (colorList != nil) {
        [instance addColorList: colorList key: name];
      }
    }

    if (instance.isEmpty) {
      // Should not happen, but on old versions of OS X reading can fail (see Bug #81)
      NSLog(@"Failed to load any palette. Adding fallback palette");
      [instance addColorList: createFallbackPalette() key: fallbackColorListKey];
    }

#ifdef ENABLE_PALETTE_GRANDPERSPECTIVE
    [instance addColorList: createGrandPerspectivePalette() key: @"GrandPerspective"];
#endif

    defaultColorListCollectionInstance = [instance retain];
  });
  
  return defaultColorListCollectionInstance;
}


// Overrides designated initialiser.
- (instancetype) init {
  if (self = [super init]) {
    colorListDictionary = [[NSMutableDictionary alloc] initWithCapacity: 8];
  }
  
  return self;
}

- (void) dealloc {
  [colorListDictionary release];

  [super dealloc];
}


- (void) addColorList:(NSColorList *)colorList key:(NSString *)key {
  colorListDictionary[key] = colorList;
}

- (void) removeColorListForKey:(NSString *)key {
  [colorListDictionary removeObjectForKey: key];
}


- (NSArray<NSString *> *)allKeys {
  return colorListDictionary.allKeys;
}

- (NSArray<NSString *> *)allKeysSortedByPaletteSize:(NSComparator)tieBreaker {
  NSMutableDictionary  *colorListSizes =
    [NSMutableDictionary dictionaryWithCapacity: colorListDictionary.count];

  // Store palette sizes in a temporary dictionary (to be sure there's no repeated instantiation of
  // the allKeys array)
  [colorListDictionary enumerateKeysAndObjectsUsingBlock:^(NSString *name, NSColorList *list,
                                                           BOOL *stop) {
    colorListSizes[name] = @(list.allKeys.count);
  }];

  // Sort the palettes first by their size, using the provided tie-breaker for equal sizes (to
  // enable sorting by localized name)
  return [colorListDictionary.allKeys
          sortedArrayUsingComparator:^NSComparisonResult(id _Nonnull key1, id _Nonnull key2) {
    NSComparisonResult  result = [colorListSizes[key1] compare: colorListSizes[key2]];
    if (result != NSOrderedSame) {
      return result;
    }

    return tieBreaker(key1, key2);
  }];
}

- (NSColorList *)colorListForKey:(NSString *)key {
  return colorListDictionary[key];
}

- (NSColorList *)fallbackColorList {
  NSColorList  *fallback = nil;

  // First try the preferred default as specified by the user
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  fallback = [self colorListForKey: [userDefaults stringForKey: DefaultColorPaletteKey]];

  // Otherwise try a hardcoded default
  if (fallback == nil) {
    fallback = [self colorListForKey: @"CoffeeBeans"];
  }

  // Otherwise return an arbitrary palette. If none could be loaded, this will be the fallback
  // hardcode palette returned by createFallbackPalette().
  if (fallback == nil) {
    fallback = [self colorListForKey: self.allKeys[0]];
  }

  return fallback;
}

@end // @implementation ColorListCollection

@implementation ColorListCollection (PrivateMethods)

- (bool) isEmpty {
  return colorListDictionary.count == 0;
}

@end
