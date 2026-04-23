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

#import "TimeBasedMapping.h"

#import "CompoundItem.h"
#import "DirectoryItem.h"
#import "PlainFileItem.h"

#import "PreferencesPanelControl.h"
#import "TreeWriter.h"

@interface TimeBasedMapping (PrivateMethods)

- (void) initTimeBounds:(DirectoryItem *)treeRoot;
- (void) visitItemToDetermineTimeBounds:(Item *)item;

@end // @interface TimeBasedMapping (PrivateMethods)


@implementation TimeBasedMapping

const int  secondsPerDay = 60 * 60 * 24;

// Set minimum time granularity to a minute 
const int  minTimeDelta = 60;

- (instancetype) initWithTree:(DirectoryItem *)tree {
  if (self = [super init]) {
    [self initTimeBounds: tree];
  }
  return self;
}


- (NSUInteger) hashForFileItem:(FileItem *)item atDepth:(NSUInteger)depth {
  CFAbsoluteTime  itemTime = nowTime - [self timeForFileItem: item];
  CFAbsoluteTime  refTime = nowTime - minTime;
  NSUInteger  hash = 0;
  
  while (refTime > minTimeDelta) {
    if (itemTime > refTime) {
      return hash;
    }
    hash++;
    refTime /= 2;
  }

  return hash;
}

- (NSUInteger) colorIndexForHash:(NSUInteger)hash numColors:(NSUInteger)numColors {
  return MIN(hash, numColors - 1);
}

- (BOOL)providesLegend {
  return YES;
}

- (NSString *)legendForColorIndex:(NSUInteger)colorIndex numColors:(NSUInteger)numColors {
  CFAbsoluteTime  lowerBound = 0;
  CFAbsoluteTime  upperBound = minTime;
  
  NSUInteger  i = colorIndex;
  while (i > 0) {
    lowerBound = upperBound;
    upperBound = lowerBound + (nowTime - lowerBound) / 2;
    i--;
  }
  
  int  maxDelta = (int) floor((nowTime - lowerBound) / secondsPerDay);
  int  minDelta = (int) ceil((nowTime - upperBound) / secondsPerDay);
  
  if (colorIndex == 0) {
    NSString *fmt = NSLocalizedString(@"%d days ago or more",
                                      @"Legend for Time-based mapping schemes.");
    return [NSString stringWithFormat: fmt, minDelta];
  } else if (minDelta < maxDelta) {
    if (colorIndex < numColors - 1) {
      NSString *fmt = NSLocalizedString(@"%d - %d days ago",
                                        @"Legend for Time-based mapping schemes.");
      return [NSString stringWithFormat: fmt, minDelta, maxDelta];
    } else {
      return NSLocalizedString(@"More recent",
                               @"Legend for Time-based mapping schemes.");
    }
  } else {
    NSString *fmt = NSLocalizedString(@"%d days ago",
                                      @"Legend for Time-based mapping schemes.");
    return [NSString stringWithFormat: fmt, maxDelta];
  }
}

@end // @implementation TimeBasedMapping


@implementation TimeBasedMapping (PrivateMethods)

- (void) initTimeBounds:(DirectoryItem *)treeRoot {
  minTime = 0;
  maxTime = 0;
  [self visitItemToDetermineTimeBounds: treeRoot];
  
  nowTime = CFAbsoluteTimeGetCurrent();
  if (maxTime > nowTime) {
    NSLog(@"Maximum time is in the future.");
  }
  if (minTime > nowTime) {
    NSLog(@"Minimum time is in the future.");
  }
  
  // Check if the preferences override the minimum.
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  NSString  *minTimeBoundString = [userDefaults stringForKey: MinimumTimeBoundForColorMappingKey];
  CFAbsoluteTime minTimeBound;
    
  static CFDateFormatterRef dateFormatter = NULL;
  if (dateFormatter == NULL) {
    // Lazily create formatter
    dateFormatter = CFDateFormatterCreate(kCFAllocatorDefault,
                                          NULL,
                                          kCFDateFormatterNoStyle,
                                          kCFDateFormatterNoStyle);
    CFDateFormatterSetFormat(dateFormatter, (CFStringRef)@"dd/MM/yyyy HH:mm");
  }
  Boolean ok = CFDateFormatterGetAbsoluteTimeFromString(dateFormatter,
                                                        (CFStringRef) minTimeBoundString,
                                                        NULL,
                                                        &minTimeBound);
  if (! ok) {
    NSLog(@"Failed to parse preference value for %@: %@", 
          MinimumTimeBoundForColorMappingKey,
          minTimeBoundString);
  } else if (minTimeBound > nowTime) {
    NSLog(@"Ignoring preference value for %@. It occurs in the future.",
          MinimumTimeBoundForColorMappingKey);
  } else if (minTime < minTimeBound) {
    minTime = minTimeBound;
    NSLog(@"Basing minTime on value specified in preferences.");
  }

  NSLog(@"minTime=%@, maxTime=%@", 
        [FileItem stringForTime: minTime],
        [FileItem stringForTime: maxTime]);
}


- (void) visitItemToDetermineTimeBounds:(Item *)item {
  if (item.isVirtual) {
    [self visitItemToDetermineTimeBounds: ((CompoundItem *)item).first];
    [self visitItemToDetermineTimeBounds: ((CompoundItem *)item).second];
  }
  else {
    FileItem  *fileItem = (FileItem *)item;
    
    if (fileItem.isPhysical) {
      // Only consider actual files.
      
      CFAbsoluteTime  itemTime = [self timeForFileItem: fileItem];
      if (itemTime != 0) {
        if (minTime == 0 || itemTime < minTime) {
          minTime = itemTime;
        }
        if (maxTime == 0 || itemTime > maxTime) {
          maxTime = itemTime;
        }
      }
    }
    
    if (fileItem.isDirectory) {
      [self visitItemToDetermineTimeBounds: ((DirectoryItem *)fileItem).fileItems];
      [self visitItemToDetermineTimeBounds: ((DirectoryItem *)fileItem).directoryItems];
    }
  }
}

@end // @implementation TimeBasedMapping (PrivateMethods)
