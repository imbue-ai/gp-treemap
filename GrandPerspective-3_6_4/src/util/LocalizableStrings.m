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

#import "LocalizableStrings.h"


@interface LocalizableStrings (PrivateMethods)

+ (NSString *)localizedEnumerationString:(NSArray *)items
                            pairTemplate:(NSString *)pairTemplate
                       bootstrapTemplate:(NSString *)bootstrapTemplate;

@end // @interface LocalizableStrings (PrivateMethods)


@implementation LocalizableStrings

+ (NSString *)localizedAndEnumerationString:(NSArray *)items {
  NSString  *pairTemplate = NSLocalizedString(@"%@ and %@", @"Enumeration of two items");
  NSString  *bootstrapTemplate = NSLocalizedString(@"%@, and %@",
    @"Enumeration of three or more items with 1: two or more items, 2: last item");
  return [self localizedEnumerationString: items
                             pairTemplate: pairTemplate
                        bootstrapTemplate: bootstrapTemplate];
}

+ (NSString *)localizedOrEnumerationString:(NSArray *)items {
  NSString  *pairTemplate = NSLocalizedString(@"%@ or %@", @"Enumeration of two items");
  NSString  *bootstrapTemplate = NSLocalizedString(@"%@, or %@",
    @"Enumeration of three or more items with 1: two or more items, 2: last item");
  return [self localizedEnumerationString: items
                             pairTemplate: pairTemplate
                        bootstrapTemplate: bootstrapTemplate];
}

+ (NSString *)localizedEnumerationString:(NSArray *)items
                            pairTemplate:(NSString *)pairTemplate
                       bootstrapTemplate:(NSString *)bootstrapTemplate
                       repeatingTemplate:(NSString *)repeatingTemplate {
  if (items.count == 0) {
    return @"";
  }
  else if (items.count == 1) {
    return items[0];
  }
  else if (items.count == 2) {
    return [NSString stringWithFormat: pairTemplate, items[0], items[1]];
  }
  else {
    NSEnumerator  *itemEnum = [items reverseObjectEnumerator];

    NSString  *item = [itemEnum nextObject]; // Last item
    NSString  *s = [NSString stringWithFormat: bootstrapTemplate, [itemEnum nextObject], item];

    while (item = [itemEnum nextObject]) {
      s = [NSString stringWithFormat: repeatingTemplate, item, s];
    }
    
    return s;
  }
}

@end // @implementation LocalizableStrings


@implementation LocalizableStrings (PrivateMethods)

+ (NSString *)localizedEnumerationString:(NSArray *)items
                            pairTemplate:(NSString *)pairTemplate
                       bootstrapTemplate:(NSString *)bootstrapTemplate {
  NSString  *repeatingTemplate = NSLocalizedString(@"%@, %@",
    @"Enumeration of three or more items with 1: an item, 2: two or more items");
  return [self localizedEnumerationString: items
                             pairTemplate: pairTemplate
                        bootstrapTemplate: bootstrapTemplate
                        repeatingTemplate: repeatingTemplate];
}

@end // @implementation LocalizableStrings (PrivateMethods)

