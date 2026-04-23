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

#import "WindowManager.h"


@interface WindowManager (PrivateMethods)

- (NSString *) makeTitleUnique:(NSString *)title;
- (NSString *) stripTitle:(NSString *)title;

@end


@implementation WindowManager

- (instancetype) init {
  if (self = [super init]) {
    titleLookup = [[NSMutableDictionary alloc] initWithCapacity: 8];
    
    nextWindowPosition = NSZeroPoint;
  }
  return self;
}

- (void) dealloc {
  [titleLookup release];

  [super dealloc];
}

- (void) addWindow:(NSWindow *)window usingTitle:(NSString *)title {
  nextWindowPosition = [window cascadeTopLeftFromPoint: nextWindowPosition]; 
  window.title = [self makeTitleUnique: title];
}

@end


@implementation WindowManager (PrivateMethods)

- (NSString *) makeTitleUnique: (NSString *)title {
  NSString*  strippedTitle = [self stripTitle: title];

  NSNumber*  count = titleLookup[strippedTitle];
  NSUInteger  newCount = (count == nil) ? 1 : count.unsignedIntegerValue + 1;

  titleLookup[strippedTitle] = @(newCount);
    
  if (newCount == 1) {
    // First use of this (base) title
    
    return strippedTitle;
  }
  else {
    // This title has been used before. Append the count to make it unique.
    
    NSMutableString*  uniqueTitle =
      [NSMutableString stringWithCapacity: strippedTitle.length + 5];
                                      
    [uniqueTitle setString: strippedTitle];
    [uniqueTitle appendFormat: @" [%lu]", (unsigned long)newCount];
    
    return uniqueTitle;
  }
}


- (NSString *)stripTitle:(NSString *)title {
  NSUInteger  pos = title.length;
  NSCharacterSet*  digitSet = NSCharacterSet.decimalDigitCharacterSet;

  if ( pos-- == 0 ||
       [title characterAtIndex: pos] != ']' ||
       pos-- == 0 ||
       ! [digitSet characterIsMember: [title characterAtIndex: pos]] ) {
    // Does not end with DIGIT + "]"
    return title;
  }
  
  // Keep stripping digits.
  while ( pos > 0 && [digitSet characterIsMember: [title characterAtIndex: pos - 1]] ) {
    pos--;
  }

  if ( pos-- == 0 ||
       [title characterAtIndex: pos] != '[' ||
       pos-- == 0 ||
       [title characterAtIndex: pos] != ' ' ) {
    // Does not contain " [" directly in front of digits.
    return title;
  }
  
  // Return the title, with " [" + DIGITS + "]" stripped.
  return [title substringToIndex: pos];
}

@end // @implementation WindowManager (PrivateMethods)
